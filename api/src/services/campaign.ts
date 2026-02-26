import { Schemas } from '../schemas/zod.js';
import { runActor } from './apify.js';
import { ACTORS } from '../constants/actors.js';
import { transformPost, engagementScore } from './transform.js';
import { getCollection } from './mongo.js';
import { getOrFetchProfile, classifyTier, batchLoadCachedProfiles } from './analytics.js';
import type {
  Campaign, CampaignPost, PostSnapshot, PostSnapshotRecord,
  InfluencerRecord, ComplianceStatus, PostStatus,
} from '../schemas/types.js';

// ─── Campaign CRUD ───────────────────────────────────────────────────────────

export async function createCampaign(data: Record<string, unknown>): Promise<Campaign> {
  const parsed = Schemas.create_campaign.parse(data);
  const now = new Date();
  const campaign: Campaign = {
    ...parsed,
    createdAt: now,
    updatedAt: now,
  };
  const coll = getCollection<Campaign>('campaigns');
  await coll.updateOne(
    { campaignId: campaign.campaignId },
    { $set: campaign },
    { upsert: true },
  );
  return campaign;
}

export async function getCampaign(campaignId: string): Promise<Campaign | null> {
  return getCollection<Campaign>('campaigns').findOne({ campaignId });
}

export async function listCampaigns(filter?: { status?: string }): Promise<Campaign[]> {
  const query: Record<string, unknown> = {};
  if (filter?.status) query.status = filter.status;
  return getCollection<Campaign>('campaigns').find(query).sort({ createdAt: -1 }).toArray();
}

export async function updateCampaign(campaignId: string, updates: Record<string, unknown>): Promise<Campaign | null> {
  const parsed = Schemas.update_campaign.parse(updates);
  const clean = Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== undefined));
  if (!Object.keys(clean).length) return getCampaign(campaignId);
  const coll = getCollection<Campaign>('campaigns');
  const result = await coll.findOneAndUpdate(
    { campaignId },
    { $set: { ...clean, updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  return result ?? null;
}

// ─── Compliance Engine ───────────────────────────────────────────────────────

export function checkCompliance(
  campaign: Campaign,
  current: PostSnapshot,
  initial: PostSnapshot,
): { status: ComplianceStatus; issues: string[] } {
  const issues: string[] = [];

  // Check required hashtags
  const currentHashtags = current.hashtags.map(h => h.toLowerCase());
  for (const req of campaign.requiredHashtags) {
    if (!currentHashtags.includes(req.toLowerCase())) {
      issues.push(`Missing required hashtag: #${req}`);
    }
  }

  // Check required mentions
  const currentMentions = current.mentionedAccounts.map(m => m.toLowerCase().replace(/^@/, ''));
  for (const req of campaign.requiredMentions) {
    if (!currentMentions.includes(req.toLowerCase())) {
      issues.push(`Missing required mention: @${req}`);
    }
  }

  // Check required tags (same as mentions for Instagram)
  for (const req of campaign.requiredTags) {
    if (!currentMentions.includes(req.toLowerCase())) {
      issues.push(`Missing required tag: @${req}`);
    }
  }

  // Check for caption changes that removed compliance elements
  if (initial.hashtags.length > current.hashtags.length) {
    const removed = initial.hashtags.filter(h => !currentHashtags.includes(h.toLowerCase()));
    if (removed.length) {
      issues.push(`Hashtags removed since initial post: ${removed.map(h => '#' + h).join(', ')}`);
    }
  }

  // Check if post is still live
  if (!current.isLive) {
    issues.push('Post appears to be deleted or unavailable');
  }

  const status: ComplianceStatus = issues.length === 0 ? 'compliant' : 'non_compliant';
  return { status, issues };
}

// ─── Build Snapshot from Apify data ──────────────────────────────────────────

function buildSnapshot(post: ReturnType<typeof transformPost>): PostSnapshot {
  return {
    caption: post.caption,
    hashtags: post.hashtags,
    mentionedAccounts: post.mentionedAccounts,
    likesCount: post.likesCount,
    commentsCount: post.commentsCount,
    viewsCount: post.viewsCount,
    playsCount: post.playsCount,
    engagementScore: post.engagementScore,
    isLive: true,
    capturedAt: new Date(),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extract the shortcode from any Instagram post/reel URL */
function extractShortcode(url: string): string | null {
  const m = url.match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[2] : null;
}

// ─── Register Campaign Posts ─────────────────────────────────────────────────

export async function registerCampaignPosts(raw: unknown) {
  const { campaignId, postUrls, usernameOverride } = Schemas.register_campaign_post.parse(raw);

  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign not found: ${campaignId}`);

  const results: { postUrl: string; status: string; error?: string }[] = [];

  for (const postUrl of postUrls) {
    try {
      // The actor requires a valid `username` to establish its Instagram session —
      // using '_' breaks session context and directUrls also fail to scrape.
      // Use the real influencer username when available; fall back to a known valid
      // GNC account so the session always works.
      const sessionUsername = usernameOverride ?? 'gnclivewell';
      const items = await runActor<Record<string, unknown>>({
        actorId: ACTORS.POSTS,
        input: { directUrls: [postUrl], username: [sessionUsername], resultsLimit: 30 },
      });

      // Filter out error items (the '_' username lookup always fails)
      const targetShortcode = extractShortcode(postUrl);
      const validItems = items.filter(i => !i.error);
      const matchedItem = targetShortcode
        ? validItems.find(i => {
            const sc = (i.shortCode ?? i.id ?? '') as string;
            const u = (i.url ?? '') as string;
            return sc === targetShortcode || u.includes(targetShortcode);
          }) ?? validItems[0]
        : validItems[0];

      if (!matchedItem) {
        results.push({ postUrl, status: 'error', error: 'Post not found on Instagram' });
        continue;
      }

      const post = transformPost(matchedItem);
      // Always use usernameOverride when provided (Apify directUrls may return '_')
      if (usernameOverride) {
        post.username = usernameOverride;
      } else if (post.username === '_' || !post.username) {
        post.username = '_';
      }
      const snapshot = buildSnapshot(post);

      // Run compliance check
      const { status: complianceStatus, issues } = checkCompliance(campaign, snapshot, snapshot);

      // Determine post type
      const postType = post.playsCount > 0 ? 'reel' : 'post';

      // Upsert campaign_post
      const campaignPost: Omit<CampaignPost, '_id'> = {
        campaignId,
        postUrl,
        postId: post.postId,
        username: post.username,
        platform: 'instagram',
        postType: postType as 'post' | 'reel' | 'story',
        status: 'live',
        complianceStatus,
        complianceIssues: issues,
        initialSnapshot: snapshot,
        latestSnapshot: snapshot,
        registeredAt: new Date(),
        lastCheckedAt: new Date(),
      };

      await getCollection('campaign_posts').updateOne(
        { campaignId, postUrl },
        { $set: campaignPost },
        { upsert: true },
      );

      // Save snapshot
      const snapshotRecord: Omit<PostSnapshotRecord, '_id'> = {
        postId: post.postId,
        postUrl,
        capturedAt: new Date(),
        caption: post.caption,
        hashtags: post.hashtags,
        mentionedAccounts: post.mentionedAccounts,
        likesCount: post.likesCount,
        commentsCount: post.commentsCount,
        viewsCount: post.viewsCount,
        playsCount: post.playsCount,
        engagementScore: post.engagementScore,
        isLive: true,
        captionChanged: false,
        hashtagsChanged: false,
        tagsChanged: false,
      };
      await getCollection('post_snapshots').insertOne(snapshotRecord);

      // Upsert influencer record
      await upsertInfluencerRecord(post.username, {
        campaignId,
        role: 'influencer',
        startDate: new Date(),
      });

      results.push({ postUrl, status: 'registered' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      results.push({ postUrl, status: 'error', error: msg });
    }
  }

  return {
    campaignId,
    registered: results.filter(r => r.status === 'registered').length,
    errors: results.filter(r => r.status === 'error').length,
    results,
  };
}

// ─── Monitor Campaign Post ───────────────────────────────────────────────────

export async function monitorCampaignPost(raw: unknown) {
  const { campaignId, postUrl } = Schemas.monitor_campaign_post.parse(raw);

  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign not found: ${campaignId}`);

  const campaignPost = await getCollection<CampaignPost>('campaign_posts').findOne({ campaignId, postUrl });
  if (!campaignPost) throw new Error(`Post not registered under campaign: ${campaignId}`);

  // Re-fetch from Apify
  let currentSnapshot: PostSnapshot;
  let postStatus: PostStatus = 'live';

  try {
    const shortcode = extractShortcode(postUrl);
    const sessionUser = campaignPost.username && campaignPost.username !== '_'
      ? campaignPost.username
      : 'gnclivewell';
    const items = await runActor<Record<string, unknown>>({
      actorId: ACTORS.POSTS,
      input: { directUrls: [postUrl], username: [sessionUser], resultsLimit: 30 },
    });

    const validItems = items.filter(i => !i.error);
    const matchedItem = shortcode
      ? validItems.find(i => {
          const sc = (i.shortCode ?? i.id ?? '') as string;
          const u = (i.url ?? '') as string;
          return sc === shortcode || u.includes(shortcode);
        }) ?? validItems[0]
      : validItems[0];

    if (!matchedItem) {
      postStatus = 'deleted';
      currentSnapshot = {
        ...campaignPost.latestSnapshot,
        isLive: false,
        capturedAt: new Date(),
      };
    } else {
      const post = transformPost(matchedItem);
      currentSnapshot = buildSnapshot(post);

      // Detect edits
      if (campaignPost.initialSnapshot.caption !== currentSnapshot.caption) {
        postStatus = 'edited';
      }
    }
  } catch {
    postStatus = 'unknown';
    currentSnapshot = {
      ...campaignPost.latestSnapshot,
      isLive: false,
      capturedAt: new Date(),
    };
  }

  // Compliance check
  const { status: complianceStatus, issues } = checkCompliance(campaign, currentSnapshot, campaignPost.initialSnapshot);

  // Save snapshot
  const snapshotRecord: Omit<PostSnapshotRecord, '_id'> = {
    postId: campaignPost.postId,
    postUrl,
    capturedAt: new Date(),
    caption: currentSnapshot.caption,
    hashtags: currentSnapshot.hashtags,
    mentionedAccounts: currentSnapshot.mentionedAccounts,
    likesCount: currentSnapshot.likesCount,
    commentsCount: currentSnapshot.commentsCount,
    viewsCount: currentSnapshot.viewsCount,
    playsCount: currentSnapshot.playsCount,
    engagementScore: currentSnapshot.engagementScore,
    isLive: currentSnapshot.isLive,
    captionChanged: campaignPost.initialSnapshot.caption !== currentSnapshot.caption,
    hashtagsChanged: JSON.stringify(campaignPost.initialSnapshot.hashtags) !== JSON.stringify(currentSnapshot.hashtags),
    tagsChanged: JSON.stringify(campaignPost.initialSnapshot.mentionedAccounts) !== JSON.stringify(currentSnapshot.mentionedAccounts),
  };
  await getCollection('post_snapshots').insertOne(snapshotRecord);

  // Update campaign_post
  await getCollection('campaign_posts').updateOne(
    { campaignId, postUrl },
    {
      $set: {
        status: postStatus,
        complianceStatus,
        complianceIssues: issues,
        latestSnapshot: currentSnapshot,
        lastCheckedAt: new Date(),
      },
    },
  );

  // Update influencer compliance violations if non-compliant
  if (complianceStatus === 'non_compliant') {
    await getCollection('influencer_records').updateOne(
      { username: campaignPost.username },
      { $inc: { complianceViolations: 1 }, $set: { updatedAt: new Date() } },
    );
  }

  return {
    campaignId,
    postUrl,
    postStatus,
    complianceStatus,
    complianceIssues: issues,
    metricsChange: {
      likes: currentSnapshot.likesCount - campaignPost.latestSnapshot.likesCount,
      comments: currentSnapshot.commentsCount - campaignPost.latestSnapshot.commentsCount,
      views: currentSnapshot.viewsCount - campaignPost.latestSnapshot.viewsCount,
    },
    captionChanged: campaignPost.initialSnapshot.caption !== currentSnapshot.caption,
    hashtagsChanged: JSON.stringify(campaignPost.initialSnapshot.hashtags) !== JSON.stringify(currentSnapshot.hashtags),
  };
}

// ─── Campaign Compliance Report ──────────────────────────────────────────────

export async function getCampaignComplianceReport(raw: unknown) {
  const { campaignId } = Schemas.get_campaign_compliance_report.parse(raw);

  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign not found: ${campaignId}`);

  const posts = await getCollection<CampaignPost>('campaign_posts')
    .find({ campaignId })
    .toArray();

  const compliant = posts.filter(p => p.complianceStatus === 'compliant');
  const nonCompliant = posts.filter(p => p.complianceStatus === 'non_compliant');
  const pending = posts.filter(p => p.complianceStatus === 'pending_review');
  const deleted = posts.filter(p => p.status === 'deleted');
  const edited = posts.filter(p => p.status === 'edited');

  // Aggregate common issues
  const issueFrequency: Record<string, number> = {};
  for (const p of nonCompliant) {
    for (const issue of p.complianceIssues) {
      issueFrequency[issue] = (issueFrequency[issue] ?? 0) + 1;
    }
  }

  return {
    campaignId,
    campaignName: campaign.name,
    totalPosts: posts.length,
    compliant: compliant.length,
    nonCompliant: nonCompliant.length,
    pendingReview: pending.length,
    complianceRate: posts.length ? Math.round((compliant.length / posts.length) * 100) : 0,
    deletedPosts: deleted.length,
    editedPosts: edited.length,
    commonIssues: Object.entries(issueFrequency)
      .sort(([, a], [, b]) => b - a)
      .map(([issue, count]) => ({ issue, count })),
    nonCompliantDetails: nonCompliant.map(p => ({
      postUrl: p.postUrl,
      username: p.username,
      issues: p.complianceIssues,
      status: p.status,
    })),
  };
}

// ─── Evaluate Collaboration Performance ──────────────────────────────────────

export async function evaluateCollaborationPerformance(raw: unknown) {
  const { campaignId, username } = Schemas.evaluate_collaboration_performance.parse(raw);

  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign not found: ${campaignId}`);

  const posts = await getCollection<CampaignPost>('campaign_posts')
    .find({ campaignId, username })
    .toArray();

  if (!posts.length) throw new Error(`No posts found for ${username} in campaign ${campaignId}`);

  // Get influencer average engagement
  const profile = await getOrFetchProfile(username);
  const followers = (profile?.followersCount as number) ?? 0;

  // Calculate post performance
  const totalEngagement = posts.reduce((s, p) => s + p.latestSnapshot.engagementScore, 0);
  const avgEngagement = totalEngagement / posts.length;
  const totalLikes = posts.reduce((s, p) => s + p.latestSnapshot.likesCount, 0);
  const totalComments = posts.reduce((s, p) => s + p.latestSnapshot.commentsCount, 0);
  const totalViews = posts.reduce((s, p) => s + p.latestSnapshot.viewsCount, 0);
  // Use engagementScore (likes + comments + views*0.1 + plays*0.1) so reels
  // with hidden likes still show a meaningful rate via view/play counts
  const engagementRate = followers > 0 ? avgEngagement / followers : 0;

  // Get hashtag average for comparison — use aggregation to avoid loading
  // the full post collection into memory (could be hundreds of documents).
  let hashtagAvgEngagement = 0;
  if (campaign.requiredHashtags.length) {
    const [agg] = await getCollection('ig_hashtag_posts').aggregate<{ avg: number }>([
      { $match: { sourceHashtag: { $in: campaign.requiredHashtags } } },
      { $group: { _id: null, avg: { $avg: '$engagementScore' } } },
    ]).toArray();
    if (agg) hashtagAvgEngagement = agg.avg ?? 0;
  }

  // Determine performance level
  const vsHashtagAvg = hashtagAvgEngagement > 0 ? avgEngagement / hashtagAvgEngagement : 1;
  let performanceLevel: string;
  let performanceScore: number;

  if (vsHashtagAvg >= 1.5) {
    performanceLevel = 'overperformed';
    performanceScore = Math.min(100, Math.round(vsHashtagAvg * 50));
  } else if (vsHashtagAvg >= 0.8) {
    performanceLevel = 'met_expectations';
    performanceScore = Math.round(vsHashtagAvg * 50);
  } else {
    performanceLevel = 'underperformed';
    performanceScore = Math.round(vsHashtagAvg * 50);
  }

  // Update influencer record with performance
  const influencerColl = getCollection<InfluencerRecord>('influencer_records');
  await influencerColl.updateOne(
    { username, 'collaborationHistory.campaignId': campaignId },
    {
      $set: {
        'collaborationHistory.$.performance': performanceScore,
        'collaborationHistory.$.endDate': new Date(),
        updatedAt: new Date(),
      },
    },
  );

  // Recalculate average performance
  const influencer = await influencerColl.findOne({ username });
  if (influencer) {
    const scores = influencer.collaborationHistory
      .map(c => c.performance)
      .filter((p): p is number => p !== null);
    const avgPerf = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    await influencerColl.updateOne({ username }, { $set: { averagePerformanceScore: avgPerf } });
  }

  return {
    campaignId,
    username,
    postsTracked: posts.length,
    performanceLevel,
    performanceScore,
    metrics: {
      totalEngagement,
      avgEngagementPerPost: Math.round(avgEngagement),
      engagementRate: (engagementRate * 100).toFixed(2) + '%',
      totalLikes,
      totalComments,
      totalViews,
      followersCount: followers,
      tier: classifyTier(followers),
    },
    comparison: {
      vsHashtagAverage: (vsHashtagAvg * 100).toFixed(0) + '%',
      hashtagAvgEngagement: Math.round(hashtagAvgEngagement),
    },
    complianceStatus: posts.every(p => p.complianceStatus === 'compliant') ? 'fully_compliant' : 'has_issues',
    complianceIssueCount: posts.reduce((s, p) => s + p.complianceIssues.length, 0),
  };
}

// ─── Continuation Recommendation ─────────────────────────────────────────────

export async function getContinuationRecommendation(raw: unknown) {
  const { username } = Schemas.get_continuation_recommendation.parse(raw);

  const influencer = await getCollection<InfluencerRecord>('influencer_records').findOne({ username });
  if (!influencer) throw new Error(`No influencer record found for: ${username}`);

  const allPosts = await getCollection<CampaignPost>('campaign_posts')
    .find({ username })
    .toArray();

  if (!allPosts.length) throw new Error(`No campaign posts found for: ${username}`);

  // Weight components
  // Performance: 0.30
  const perfScore = influencer.averagePerformanceScore ?? 50;
  const perfWeighted = (perfScore / 100) * 0.30;

  // Compliance: 0.25
  const compliantPosts = allPosts.filter(p => p.complianceStatus === 'compliant').length;
  const complianceRate = allPosts.length ? compliantPosts / allPosts.length : 0;
  const complianceWeighted = complianceRate * 0.25;

  // Organic alignment: 0.15 — check if user posts organically about brand topics
  const profile = await getOrFetchProfile(username);
  const bio = ((profile as Record<string, unknown> | null)?.bio as string ?? '').toLowerCase();
  const organicSignals = ['fitness', 'health', 'nutrition', 'supplement', 'protein', 'gym', 'workout'];
  const organicScore = organicSignals.filter(s => bio.includes(s)).length / organicSignals.length;
  const organicWeighted = organicScore * 0.15;

  // Saturation: 0.15 — too many campaigns = audience fatigue
  const campaignCount = influencer.totalCollaborations;
  const saturationScore = campaignCount <= 2 ? 1 : campaignCount <= 5 ? 0.7 : campaignCount <= 10 ? 0.4 : 0.2;
  const saturationWeighted = saturationScore * 0.15;

  // Decay: 0.15 — how recent was the last collaboration
  const lastCollab = influencer.lastCollaborationDate;
  const daysSinceLast = lastCollab ? (Date.now() - new Date(lastCollab).getTime()) / 86_400_000 : 365;
  const decayScore = daysSinceLast < 30 ? 1 : daysSinceLast < 90 ? 0.8 : daysSinceLast < 180 ? 0.5 : 0.3;
  const decayWeighted = decayScore * 0.15;

  const totalScore = perfWeighted + complianceWeighted + organicWeighted + saturationWeighted + decayWeighted;
  const normalizedScore = Math.round(totalScore * 100);

  let recommendation: string;
  let reasoning: string;

  if (normalizedScore >= 70) {
    recommendation = 'continue';
    reasoning = 'Strong performance, good compliance, and brand alignment suggest continued partnership.';
  } else if (normalizedScore >= 45) {
    recommendation = 'pause';
    reasoning = 'Mixed signals — consider a trial period with specific performance targets.';
  } else {
    recommendation = 'discontinue';
    reasoning = 'Below threshold on multiple factors. Consider alternative influencers.';
  }

  return {
    username,
    recommendation,
    score: normalizedScore,
    reasoning,
    breakdown: {
      performance: { score: perfScore, weight: 0.30, weighted: Math.round(perfWeighted * 100) },
      compliance: { rate: Math.round(complianceRate * 100) + '%', weight: 0.25, weighted: Math.round(complianceWeighted * 100) },
      organicAlignment: { score: Math.round(organicScore * 100), weight: 0.15, weighted: Math.round(organicWeighted * 100) },
      saturation: { campaigns: campaignCount, score: Math.round(saturationScore * 100), weight: 0.15, weighted: Math.round(saturationWeighted * 100) },
      recency: { daysSinceLast: Math.round(daysSinceLast), score: Math.round(decayScore * 100), weight: 0.15, weighted: Math.round(decayWeighted * 100) },
    },
    lifecycleStatus: influencer.lifecycleStatus,
    totalCollaborations: influencer.totalCollaborations,
    complianceViolations: influencer.complianceViolations,
  };
}

// ─── Engagement Timeline ─────────────────────────────────────────────────────

export async function getEngagementTimeline(raw: unknown) {
  const { postUrl, limit } = Schemas.get_engagement_timeline.parse(raw);

  const snapshots = await getCollection<PostSnapshotRecord>('post_snapshots')
    .find({ postUrl })
    .sort({ capturedAt: 1 })
    .limit(limit)
    .toArray();

  if (!snapshots.length) throw new Error(`No snapshots found for: ${postUrl}`);

  const timeline = snapshots.map((s, i) => ({
    capturedAt: s.capturedAt,
    likes: s.likesCount,
    comments: s.commentsCount,
    views: s.viewsCount,
    plays: s.playsCount,
    engagementScore: s.engagementScore,
    isLive: s.isLive,
    likesDelta: i > 0 ? s.likesCount - snapshots[i - 1].likesCount : 0,
    commentsDelta: i > 0 ? s.commentsCount - snapshots[i - 1].commentsCount : 0,
    viewsDelta: i > 0 ? s.viewsCount - snapshots[i - 1].viewsCount : 0,
  }));

  // Compute trend
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const engagementGrowth = first.engagementScore > 0
    ? ((last.engagementScore - first.engagementScore) / first.engagementScore * 100).toFixed(1) + '%'
    : 'n/a';

  return {
    postUrl,
    snapshotCount: snapshots.length,
    firstCaptured: first.capturedAt,
    lastCaptured: last.capturedAt,
    engagementGrowth,
    currentMetrics: {
      likes: last.likesCount,
      comments: last.commentsCount,
      views: last.viewsCount,
      engagementScore: last.engagementScore,
      isLive: last.isLive,
    },
    timeline,
  };
}

// ─── Mine Competitor Hashtags ────────────────────────────────────────────────

export async function mineCompetitorHashtags(raw: unknown) {
  const { competitorHashtags, limit } = Schemas.mine_competitor_hashtags.parse(raw);

  const coll = getCollection('ig_hashtag_posts');

  // Aggregate top creators across competitor hashtags
  const pipeline: Record<string, unknown>[] = [
    { $match: { sourceHashtag: { $in: competitorHashtags } } },
    {
      $group: {
        _id: '$username',
        totalPosts: { $sum: 1 },
        avgEngagementScore: { $avg: '$engagementScore' },
        avgLikes: { $avg: '$likesCount' },
        avgComments: { $avg: '$commentsCount' },
        hashtags: { $addToSet: '$sourceHashtag' },
        sponsoredCount: { $sum: { $cond: ['$isSponsored', 1, 0] } },
      },
    },
    { $match: { totalPosts: { $gte: 2 } } },
    { $sort: { avgEngagementScore: -1 } },
    { $limit: limit * 3 },
  ];

  const candidates = await coll.aggregate(pipeline).toArray();

  // Batch-load cached profiles in one MongoDB query; only hit Apify for misses
  const competitorUsernames = candidates.map(c => c._id as string);
  const profileCache = await batchLoadCachedProfiles(competitorUsernames);

  // Enrich with profiles
  const enriched = await Promise.allSettled(
    candidates.map(async (c) => {
      const profile = profileCache.get(c._id as string) ?? await getOrFetchProfile(c._id as string);
      const fc = (profile?.followersCount as number) ?? 0;
      return {
        username: c._id as string,
        followersCount: fc,
        tier: classifyTier(fc),
        postsInCompetitorHashtags: c.totalPosts as number,
        avgEngagementScore: Math.round(c.avgEngagementScore as number),
        competitorHashtagsUsed: c.hashtags as string[],
        sponsoredRatio: Math.round(((c.sponsoredCount as number) / (c.totalPosts as number)) * 100) + '%',
        isVerified: profile?.isVerified ?? false,
      };
    }),
  );

  const results = enriched
    .filter(r => r.status === 'fulfilled' && r.value !== null)
    .map(r => (r as PromiseFulfilledResult<Record<string, unknown>>).value)
    .slice(0, limit)
    .map((v, i) => ({ rank: i + 1, ...v }));

  return {
    competitorHashtags,
    influencersFound: results.length,
    influencers: results,
  };
}

// ─── Campaign Performance Summary (all collaborators at once) ────────────────

export async function getCampaignPerformanceSummary(raw: unknown) {
  const { campaignId } = Schemas.get_campaign_performance_summary.parse(raw);

  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign not found: ${campaignId}`);

  // Get all unique usernames in this campaign
  const posts = await getCollection<CampaignPost>('campaign_posts').find({ campaignId }).toArray();
  const usernames = [...new Set(posts.map(p => p.username).filter(u => u && u !== '_'))];

  if (!usernames.length) throw new Error(`No tracked posts with valid usernames in campaign: ${campaignId}`);

  // Evaluate each collaborator
  const evaluations = await Promise.allSettled(
    usernames.map(username => evaluateCollaborationPerformance({ campaignId, username }))
  );

  const results = evaluations.map((e, i) => {
    if (e.status === 'fulfilled') return e.value;
    return { username: usernames[i], error: e.reason instanceof Error ? e.reason.message : 'Evaluation failed' };
  });

  // Sort by performanceScore desc (errors last)
  results.sort((a, b) => {
    const sa = 'performanceScore' in a ? (a.performanceScore as number) : -1;
    const sb = 'performanceScore' in b ? (b.performanceScore as number) : -1;
    return sb - sa;
  });

  const succeeded = results.filter(r => !('error' in r));
  const avgScore = succeeded.length
    ? Math.round(succeeded.reduce((s, r) => s + (('performanceScore' in r ? r.performanceScore as number : 0)), 0) / succeeded.length)
    : 0;

  return {
    campaignId,
    campaignName: campaign.name,
    totalCollaborators: usernames.length,
    evaluated: succeeded.length,
    avgPerformanceScore: avgScore,
    collaborators: results,
  };
}

// ─── Influencer Lifecycle ────────────────────────────────────────────────────

export async function getInfluencerLifecycle(username: string) {
  return getCollection<InfluencerRecord>('influencer_records').findOne({ username: username.toLowerCase() });
}

export async function upsertInfluencerRecord(
  username: string,
  collaboration: { campaignId: string; role: string; fee?: number; startDate: Date },
) {
  const coll = getCollection<InfluencerRecord>('influencer_records');
  const now = new Date();
  const normalizedUsername = username.toLowerCase();

  const existing = await coll.findOne({ username: normalizedUsername });

  if (existing) {
    // Check if this campaign already exists in history
    const hasEntry = existing.collaborationHistory.some(c => c.campaignId === collaboration.campaignId);
    if (!hasEntry) {
      await coll.updateOne(
        { username: normalizedUsername },
        {
          $push: {
            collaborationHistory: {
              ...collaboration,
              performance: null,
            },
          },
          $inc: { totalCollaborations: 1 },
          $set: {
            lastCollaborationDate: now,
            lifecycleStatus: 'active',
            updatedAt: now,
          },
        },
      );
    }
  } else {
    const record: Omit<InfluencerRecord, '_id'> = {
      username: normalizedUsername,
      lifecycleStatus: 'active',
      collaborationHistory: [{
        ...collaboration,
        performance: null,
      }],
      totalCollaborations: 1,
      lastCollaborationDate: now,
      averagePerformanceScore: null,
      complianceViolations: 0,
      notes: [],
      tags: [],
      createdAt: now,
      updatedAt: now,
    };
    await coll.insertOne(record as InfluencerRecord);
  }
}
