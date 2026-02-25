import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { createSession, getSession, setSession } from '../services/session_store.js';
import { orchestrate, trimHistory, type OrchestrateEvent } from '../services/gemini.js';

export const chatRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ChatRequestSchema = z.object({
  message: z.string().min(1).max(2000),
  sessionId: z.string().regex(UUID_RE).optional(),
});

const CHAT_TIMEOUT_MS = 120_000; // 2 min hard cap — Apify max is 90s

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };
}

// ── REST endpoint (backwards-compatible JSON response) ────────────────────────

chatRouter.post('/chat', asyncHandler(async (req, res) => {
  const parsed = ChatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid request',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { message, sessionId: incomingSessionId } = parsed.data;

  let sessionId = incomingSessionId ?? null;
  let history = sessionId ? getSession(sessionId) : null;
  if (!history) { sessionId = createSession(); history = []; }

  // Hard timeout — prevents infinite hangs from Gemini agentic loops
  const result = await Promise.race([
    orchestrate(message, history),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(Object.assign(new Error('Request timed out after 120s'), { status: 504 })), CHAT_TIMEOUT_MS)
    ),
  ]);

  setSession(sessionId!, trimHistory(result.history));

  res.json({
    response: result.text,
    sessionId,
    toolCalls: result.toolCalls,
    timestamp: new Date().toISOString(),
  });
}));

// ── SSE streaming endpoint ───────────────────────────────────────────────────
// POST /api/chat/stream  { message: string, sessionId?: string }
// Content-Type: text/event-stream — each event is:  data: <JSON>\n\n
//
// Event sequence:
//   connected   { type, sessionId }               ← ~50ms, confirms pipe is live
//   thinking    { type, turn, message }            ← "Analysing your request…"
//   tool_start  { type, tools[], labels[] }        ← "Searching Google for influencers…"
//   tool_done   { type, info }                     ← fires per-tool as each finishes
//   thinking    { type, turn, message }            ← "Processing tool results…" (if multi-turn)
//   text_chunk  { type, text }                     ← answer tokens streamed word-by-word
//   answer      { type, text, toolCalls[] }        ← full assembled text + all tool metadata
//   session     { type, sessionId }                ← carry this sessionId for follow-up messages
//   error       { type, message }                  ← only on failure

chatRouter.post('/chat/stream', asyncHandler(async (req, res) => {
  const parsed = ChatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid request',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { message, sessionId: incomingSessionId } = parsed.data;

  let sessionId = incomingSessionId ?? null;
  let history = sessionId ? getSession(sessionId) : null;
  if (!history) { sessionId = createSession(); history = []; }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable Nginx buffering behind proxies/Render
  res.flushHeaders();

  // ← connected event arrives ~50ms after POST — client knows the pipe is live immediately
  //   and gets the sessionId to carry into follow-up requests without waiting for the answer
  res.write(`data: ${JSON.stringify({ type: 'connected', sessionId })}\n\n`);

  // Heartbeat comment keeps connection alive through proxies that kill idle SSE streams
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(':ping\n\n');
  }, 15_000);

  const send = (event: OrchestrateEvent) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  let clientGone = false;
  req.on('close', () => { clientGone = true; });

  try {
    const result = await Promise.race([
      orchestrate(message, history, send),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Request timed out after 120s')), CHAT_TIMEOUT_MS)
      ),
    ]);

    if (!clientGone) {
      // answer event already emitted by orchestrate — just persist session and confirm sessionId
      setSession(sessionId!, trimHistory(result.history));
      res.write(`data: ${JSON.stringify({ type: 'session', sessionId })}\n\n`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Orchestration failed';
    if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`);
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
}));
