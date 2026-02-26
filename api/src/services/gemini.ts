import { GoogleGenerativeAI, type Content, type Part, type GenerativeModel } from '@google/generative-ai';
import { SYSTEM_PROMPT } from '../constants/system_prompt.js';
import { TOOL_DECLARATIONS } from '../constants/tool_declarations.js';
import {
  executeGetProfile, executeGetUserPosts, executeGetUserReels,
  executeGetHashtagPosts, executeGetHashtagStats, executeCheckPost,
  executeDiscoverInfluencers, executeExpandNetwork, ToolError,
} from './tools.js';
import {
  getTopPostsByReach, getBrandMentions, findTopInfluencers, checkUserTopicPosts, getMentionNetwork,
} from './analytics.js';
import {
  registerCampaignPosts, monitorCampaignPost, getCampaignComplianceReport,
  evaluateCollaborationPerformance, getContinuationRecommendation,
  getEngagementTimeline, mineCompetitorHashtags, getCampaignPerformanceSummary,
} from './campaign.js';

const MAX_TURNS = 10;

// ─── Singleton Gemini model (created once per process) ───────────────────────
// GoogleGenerativeAI + getGenerativeModel is non-trivial to construct: it
// allocates HTTP agents, parses tool declarations, and stores the system
// prompt.  Building it inside orchestrate() (per-request) wastes CPU and
// memory on every chat turn.  Lazy-initialise once and reuse.
let _model: GenerativeModel | null = null;

function getModel(): GenerativeModel {
  if (_model) return _model;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
  const client = new GoogleGenerativeAI(apiKey);
  _model = client.getGenerativeModel({
    model: 'gemini-3-flash-preview',
    systemInstruction: SYSTEM_PROMPT,
    tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
  });
  return _model;
}

export interface ToolCallInfo {
  name: string;
  label: string;
  cacheHit?: boolean;
  durationMs: number;
  error?: string;
}

// ─── SSE event types ─────────────────────────────────────────────────────────
export type OrchestrateEvent =
  // Connection is live — emitted immediately before any work starts
  | { type: 'connected'; sessionId: string }
  // Gemini is processing — emitted at the start of every agentic turn
  | { type: 'thinking'; turn: number; message: string }
  // Answer tokens streamed word-by-word as Gemini generates them
  | { type: 'text_chunk'; text: string }
  // About to call these tools in parallel
  | { type: 'tool_start'; tools: string[]; labels: string[] }
  // One tool finished (fires as each parallel call completes)
  | { type: 'tool_done'; info: ToolCallInfo }
  // Final complete answer — all tool calls done, text is the full assembled response
  | { type: 'answer'; text: string; toolCalls: ToolCallInfo[] };

export type EmitFn = (event: OrchestrateEvent) => void;

// ─── Human-readable tool labels for the UI ───────────────────────────────────
const TOOL_LABELS: Record<string, string> = {
  get_profile: 'Fetching Instagram profile',
  get_user_posts: 'Fetching recent posts',
  get_user_reels: 'Fetching recent reels',
  get_hashtag_posts: 'Fetching hashtag posts',
  get_hashtag_stats: 'Analysing hashtag statistics',
  check_post: 'Verifying post',
  get_top_posts_by_reach: 'Ranking posts by reach',
  get_brand_mentions: 'Scanning brand mentions',
  find_top_influencers: 'Ranking influencers by engagement',
  check_user_topic_posts: 'Scanning creator content',
  discover_influencers: 'Searching Google for influencers',
  expand_network: 'Expanding network via Instagram recommendations',
  get_mention_network: 'Mining peer mention network',
  register_campaign_post: 'Registering campaign posts',
  monitor_campaign_post: 'Monitoring campaign post',
  get_campaign_compliance_report: 'Generating compliance report',
  evaluate_collaboration_performance: 'Evaluating collaboration performance',
  get_campaign_performance_summary: 'Generating campaign performance summary',
  get_continuation_recommendation: 'Computing continuation recommendation',
  get_engagement_timeline: 'Loading engagement timeline',
  mine_competitor_hashtags: 'Mining competitor hashtags',
};

function toolLabel(name: string) { return TOOL_LABELS[name] ?? name; }

function thinkingMessage(turn: number, prevToolCount: number): string {
  if (turn === 1) return 'Analysing your request…';
  if (prevToolCount > 0) return 'Processing tool results…';
  return 'Thinking…';
}

// ─── Tool Dispatcher ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DISPATCH: Record<string, (args: any) => Promise<unknown>> = {
  get_profile: executeGetProfile,
  get_user_posts: executeGetUserPosts,
  get_user_reels: executeGetUserReels,
  get_hashtag_posts: executeGetHashtagPosts,
  get_hashtag_stats: executeGetHashtagStats,
  check_post: executeCheckPost,
  get_top_posts_by_reach: getTopPostsByReach,
  get_brand_mentions: getBrandMentions,
  find_top_influencers: findTopInfluencers,
  check_user_topic_posts: checkUserTopicPosts,
  discover_influencers: executeDiscoverInfluencers,
  expand_network: executeExpandNetwork,
  get_mention_network: getMentionNetwork,
  register_campaign_post: registerCampaignPosts,
  monitor_campaign_post: monitorCampaignPost,
  get_campaign_compliance_report: getCampaignComplianceReport,
  evaluate_collaboration_performance: evaluateCollaborationPerformance,
  get_campaign_performance_summary: getCampaignPerformanceSummary,
  get_continuation_recommendation: getContinuationRecommendation,
  get_engagement_timeline: getEngagementTimeline,
  mine_competitor_hashtags: mineCompetitorHashtags,
};

async function executeTool(name: string, args: unknown, emit?: EmitFn): Promise<{ result: unknown; info: ToolCallInfo }> {
  const fn = DISPATCH[name];
  const label = toolLabel(name);
  if (!fn) {
    const info: ToolCallInfo = { name, label, durationMs: 0, error: `Unknown tool: ${name}` };
    emit?.({ type: 'tool_done', info });
    return { result: { error: `Unknown tool: ${name}` }, info };
  }
  const start = Date.now();
  try {
    const result = await fn(args);
    const cacheHit = typeof result === 'object' && result !== null && 'cacheHit' in result
      ? (result as Record<string, unknown>).cacheHit as boolean
      : undefined;
    const info: ToolCallInfo = { name, label, durationMs: Date.now() - start, ...(cacheHit !== undefined && { cacheHit }) };
    emit?.({ type: 'tool_done', info });
    return { result, info };
  } catch (err) {
    const message = err instanceof ToolError ? err.message : err instanceof Error ? err.message : 'Unknown error';
    const info: ToolCallInfo = { name, label, durationMs: Date.now() - start, error: message };
    emit?.({ type: 'tool_done', info });
    return { result: { error: message }, info };
  }
}

// ─── Orchestration Engine ────────────────────────────────────────────────────

export async function orchestrate(
  message: string,
  history: Content[],
  emit?: EmitFn,
  signal?: AbortSignal,
): Promise<{ text: string; history: Content[]; toolCalls: ToolCallInfo[] }> {

  const model = getModel();

  const allToolCalls: ToolCallInfo[] = [];

  history.push({ role: 'user', parts: [{ text: message }] });

  // Track repeated tool call patterns to break infinite retry loops
  let lastToolSignature = '';
  let repeatCount = 0;
  const MAX_REPEATS = 2; // break after 2 consecutive turns with identical tool names

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    emit?.({ type: 'thinking', turn: turn + 1, message: thinkingMessage(turn + 1, allToolCalls.length) });

    // generateContentStream pipes answer tokens as Gemini generates them — key for perceived speed
    // Passing the AbortSignal lets the timeout in chat.ts actually cancel the HTTP request
    // rather than just rejecting the response promise while leaving the stream open.
    const streamResult = await model.generateContentStream(
      { contents: history },
      signal ? { signal } : undefined,
    );

    // Forward text tokens immediately, skipping internal thought parts
    const textChunks: string[] = [];
    for await (const chunk of streamResult.stream) {
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        // Gemini 2.5 Flash emits thought parts before the visible response — skip them
        if ((part as { thought?: boolean }).thought) continue;
        if ('text' in part && part.text) {
          textChunks.push(part.text);
          emit?.({ type: 'text_chunk', text: part.text });
        }
      }
    }

    // Final response resolves after stream ends — contains complete parts incl. function calls
    const finalResponse = await streamResult.response;
    const candidate = finalResponse.candidates?.[0];

    if (!candidate?.content?.parts?.length) {
      const text = textChunks.join('') || 'I was unable to generate a response. Please try again.';
      emit?.({ type: 'answer', text, toolCalls: allToolCalls });
      return { text, history, toolCalls: allToolCalls };
    }

    // Add complete model turn to history (keeps thought + functionCall parts intact for context)
    history.push(candidate.content);

    const functionCalls = candidate.content.parts.filter(
      (p): p is Part & { functionCall: { name: string; args: Record<string, unknown> } } =>
        'functionCall' in p && p.functionCall !== undefined
    );

    if (!functionCalls.length) {
      // No more tool calls — text was already streamed; reconstruct full string for REST callers
      const text = textChunks.join('')
        || candidate.content.parts
          .filter(p => 'text' in p && !(p as { thought?: boolean }).thought)
          .map(p => (p as { text: string }).text)
          .join('')
        || 'Done.';
      emit?.({ type: 'answer', text, toolCalls: allToolCalls });
      return { text, history, toolCalls: allToolCalls };
    }

    // Tool calls — group duplicate names so UI shows "Scanning creator content ×5" not 5 separate lines
    const toolNames = functionCalls.map(fc => fc.functionCall.name);
    const nameCounts = toolNames.reduce<Record<string, number>>((acc, n) => { acc[n] = (acc[n] ?? 0) + 1; return acc; }, {});
    const groupedNames = Object.keys(nameCounts);
    const groupedLabels = groupedNames.map(n => nameCounts[n] > 1 ? `${toolLabel(n)} ×${nameCounts[n]}` : toolLabel(n));
    emit?.({ type: 'tool_start', tools: groupedNames, labels: groupedLabels });

    // Detect repeated identical tool call patterns — Gemini retrying the same calls
    const currentSignature = [...toolNames].sort().join(',');
    if (currentSignature === lastToolSignature) {
      repeatCount++;
      if (repeatCount >= MAX_REPEATS) {
        const text = `I was unable to retrieve the requested data after multiple attempts. The posts for these users may not be cached yet — try calling get_user_posts or get_user_reels for each user first, then retry the analysis.`;
        emit?.({ type: 'answer', text, toolCalls: allToolCalls });
        return { text, history, toolCalls: allToolCalls };
      }
    } else {
      lastToolSignature = currentSignature;
      repeatCount = 0;
    }

    // For batched calls (same tool name >1 time): suppress individual tool_done events —
    // we'll emit one grouped summary after all settle. Single-instance tools fire normally.
    const executions = await Promise.allSettled(
      functionCalls.map(fc =>
        executeTool(fc.functionCall.name, fc.functionCall.args, nameCounts[fc.functionCall.name] > 1 ? undefined : emit)
      )
    );

    // Emit one grouped tool_done per batched tool name
    const batchStats: Record<string, { succeeded: number; errors: number; totalMs: number; cacheHits: number }> = {};
    const responseParts: Part[] = functionCalls.map((fc, i) => {
      const exec = executions[i];
      let result: unknown;
      if (exec.status === 'fulfilled') {
        result = exec.value.result;
        allToolCalls.push(exec.value.info);
        if (nameCounts[fc.functionCall.name] > 1) {
          const s = batchStats[fc.functionCall.name] ??= { succeeded: 0, errors: 0, totalMs: 0, cacheHits: 0 };
          if (exec.value.info.error) s.errors++; else s.succeeded++;
          s.totalMs += exec.value.info.durationMs;
          if (exec.value.info.cacheHit) s.cacheHits++;
        }
      } else {
        const errorMsg = exec.reason instanceof Error ? exec.reason.message : 'Execution failed';
        result = { error: errorMsg };
        allToolCalls.push({ name: fc.functionCall.name, label: toolLabel(fc.functionCall.name), durationMs: 0, error: errorMsg });
        if (nameCounts[fc.functionCall.name] > 1) {
          const s = batchStats[fc.functionCall.name] ??= { succeeded: 0, errors: 0, totalMs: 0, cacheHits: 0 };
          s.errors++;
        }
      }
      return { functionResponse: { name: fc.functionCall.name, response: result as Record<string, unknown> } };
    });

    // Emit single summary event for each batched tool type
    for (const [name, s] of Object.entries(batchStats)) {
      const total = s.succeeded + s.errors;
      const avgMs = total > 0 ? Math.round(s.totalMs / total) : 0;
      const info: ToolCallInfo = {
        name,
        label: `${toolLabel(name)} ×${total}`,
        durationMs: avgMs,
        ...(s.cacheHits > 0 && { cacheHit: s.cacheHits === total }),
        ...(s.errors > 0 && { error: `${s.errors}/${total} failed` }),
      };
      emit?.({ type: 'tool_done', info });
    }

    history.push({ role: 'user', parts: responseParts });

    // Stop retrying if every tool call in this turn returned an error — prevents infinite loops
    const allFailed = executions.every(e =>
      e.status === 'rejected' || (e.status === 'fulfilled' && 'error' in (e.value.result as Record<string, unknown>))
    );
    if (allFailed) {
      const errors = executions.map((e, i) => {
        const name = functionCalls[i].functionCall.name;
        const msg = e.status === 'fulfilled'
          ? (e.value.result as Record<string, unknown>).error
          : (e.reason instanceof Error ? e.reason.message : 'failed');
        return `${name}: ${msg}`;
      });
      const text = `I encountered errors with all tool calls and cannot proceed:\n${errors.slice(0, 3).join('\n')}${errors.length > 3 ? `\n...and ${errors.length - 3} more` : ''}`;
      emit?.({ type: 'answer', text, toolCalls: allToolCalls });
      return { text, history, toolCalls: allToolCalls };
    }
  }

  // Max turns reached
  const lastModel = history.filter(h => h.role === 'model').pop();
  const text = lastModel?.parts
    ?.filter(p => 'text' in p && !(p as { thought?: boolean }).thought)
    .map(p => (p as { text: string }).text)
    .join('') || 'Reached maximum tool call depth. Here is what I found so far.';
  emit?.({ type: 'answer', text, toolCalls: allToolCalls });
  return { text, history, toolCalls: allToolCalls };
}

// ─── History Trimming ────────────────────────────────────────────────────────

export function trimHistory(history: Content[]): Content[] {
  return history.map(entry => ({
    role: entry.role,
    parts: entry.parts
      .filter(p => {
        if ('thought' in p) return false;
        return true;
      })
      .map(p => {
        if ('functionResponse' in p && p.functionResponse) {
          const resp = p.functionResponse.response as Record<string, unknown> | undefined;
          if (resp && Array.isArray(resp.posts) && resp.posts.length > 3) {
            return {
              functionResponse: {
                name: p.functionResponse.name,
                response: { ...resp, posts: `[${resp.posts.length} posts — trimmed for context]`, totalFetched: resp.totalFetched ?? resp.posts.length },
              },
            };
          }
          if (resp && Array.isArray(resp.reels) && resp.reels.length > 3) {
            return {
              functionResponse: {
                name: p.functionResponse.name,
                response: { ...resp, reels: `[${resp.reels.length} reels — trimmed for context]`, totalFetched: resp.totalFetched ?? resp.reels.length },
              },
            };
          }
          if (resp && Array.isArray(resp.results) && resp.results.length > 5) {
            return {
              functionResponse: {
                name: p.functionResponse.name,
                response: { ...resp, results: resp.results.slice(0, 5), _trimmed: true },
              },
            };
          }
        }
        return p;
      }),
  }));
}
