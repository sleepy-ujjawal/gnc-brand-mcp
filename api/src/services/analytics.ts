import { getCollection } from './mongo.js';
import { runActor } from './apify.js';
import { ACTORS } from '../constants/actors.js';
import { TTL } from '../constants/ttl.js';
import { transformProfile } from './transform.js';
import { writeCache } from '../middleware/cacheFirst.js';
import { autoEnrollBatch } from './autoEnrich.js';

export function classifyTier(followers: number): string {
  if (followers < 10_000) return 'nano';
  if (followers < 100_000) return 'micro';
  if (followers < 1_000_000) return 'macro';
  return 'mega';
}

export async function getOrFetchProfile(username: string) {
  const coll = getCollection('ig_profiles');
  const cached = await coll.findOne({ username, cachedAt: { $gt: new Date(Date.now() - TTL.PROFILES) } });
  if (cached) return cached;
  try {
    const raw = await runActor<Record<string, unknown>>({ actorId: ACTORS.PROFILE, input: { usernames: [username] }, timeoutSecs: 60 });
    if (raw.length) {
      const profile = transformProfile(raw[0]);
      writeCache('ig_profiles', { username: profile.username }, profile as unknown as Record<string, unknown>).catch(() => {});
      return profile;
    }
  } catch { /* best-effort */ }
  return null;
}

/**
 * Batch-load profiles from the MongoDB cache for a list of usernames.
 * Returns a Map<username, profile> for cache hits.
 * Callers then only need individual Apify fetches for the misses.
 */
export async function batchLoadCachedProfiles(usernames: string[]): Promise<Map<string, Record<string, unknown>>> {
  if (!usernames.length) return new Map();
  const coll = getCollection('ig_profiles');
  const cutoff = new Date(Date.now() - TTL.PROFILES);
  const docs = await coll
    .find({ username: { $in: usernames }, cachedAt: { $gt: cutoff } })
    .toArray();
  return new Map(docs.map(d => [d.username as string, d as Record<string, unknown>]));
}

export async function getTopPostsByReach(args: {
  scope: 'hashtag' | 'username'; scopeValue: string; timeframeDays: number;
  metric: string; contentType: string; limit: number;
}) {
  const cutoff = new Date(Date.now() - args.timeframeDays * 86_400_000);
  const collName = args.scope === 'hashtag' ? 'ig_hashtag_posts' : 'ig_posts';
  const coll = getCollection(collName);
  const match: Record<string, unknown> = { timestamp: { $gte: cutoff } };
  if (args.scope === 'hashtag') match.sourceHashtag = args.scopeValue;
  else match.username = args.scopeValue.toLowerCase();
  // Match both normalised ('reel'/'post') and legacy Apify values ('Video'/'Image'/'Sidecar')
  // so that existing cached docs are included regardless of when they were stored.
  if (args.contentType === 'reel') match.type = { $in: ['reel', 'Video', 'video', 'Clip', 'clip'] };
  else if (args.contentType === 'post') match.type = { $nin: ['reel', 'Video', 'video', 'Clip', 'clip'] };
  const metricMap: Record<string, string> = { engagement: 'engagementScore', likes: 'likesCount', comments: 'commentsCount', views: 'viewsCount', plays: 'playsCount' };
  const sortField = metricMap[args.metric] ?? 'engagementScore';
  const results = await coll.find(match).sort({ [sortField]: -1 }).limit(args.limit).toArray();
  return {
    results: results.map((r, i) => { const { _id, ...post } = r; return { rank: i + 1, ...post }; }),
    totalAnalysed: await coll.countDocuments(match),
  };
}

export async function getBrandMentions(args: {
  brandKeywords: string[]; hashtags: string[]; timeframeDays: number; includeHandleMentions: boolean;
}) {
  const coll = getCollection('ig_hashtag_posts');
  const cutoff = new Date(Date.now() - args.timeframeDays * 86_400_000);
  const orConds: Record<string, unknown>[] = args.brandKeywords.map(kw => ({ caption: { $regex: kw, $options: 'i' } }));
  if (args.includeHandleMentions) {
    args.brandKeywords.forEach(kw => orConds.push({ caption: { $regex: '@' + kw, $options: 'i' } }));
  }
  // Cap at 500 to avoid loading an unbounded result set into memory.
  // topMentions only uses first 10; estimatedReach/totalMentions use the capped set.
  const mentions = await coll.find({
    sourceHashtag: { $in: args.hashtags }, timestamp: { $gte: cutoff }, $or: orConds,
  }).sort({ engagementScore: -1 }).limit(500).toArray();
  const byDay: Record<string, number> = {};
  for (const m of mentions) {
    const day = new Date(m.timestamp as string).toISOString().slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + 1;
  }
  return {
    totalMentions: mentions.length,
    estimatedReach: mentions.reduce((s, m) => s + ((m.engagementScore as number) ?? 0), 0),
    mentionsByDay: byDay,
    topMentions: mentions.slice(0, 10).map(m => { const { _id, ...p } = m; return p; }),
  };
}

// Major Indian cities and states for location filtering
export const INDIA_LOCATIONS = [
  'india', 'mumbai', 'delhi', 'bangalore', 'bengaluru', 'hyderabad', 'chennai', 'kolkata',
  'pune', 'ahmedabad', 'jaipur', 'surat', 'lucknow', 'kanpur', 'nagpur', 'indore', 'thane',
  'bhopal', 'visakhapatnam', 'pimpri', 'patna', 'vadodara', 'ghaziabad', 'ludhiana', 'agra',
  'nashik', 'faridabad', 'meerut', 'rajkot', 'kalyan', 'vasai', 'varanasi', 'srinagar',
  'aurangabad', 'dhanbad', 'amritsar', 'navi mumbai', 'allahabad', 'prayagraj', 'howrah',
  'coimbatore', 'jabalpur', 'gwalior', 'vijayawada', 'jodhpur', 'madurai', 'raipur',
  'kota', 'chandigarh', 'guwahati', 'solapur', 'hubli', 'dharwad', 'mysuru', 'mysore',
  'tiruchirappalli', 'trichy', 'bareilly', 'moradabad', 'tiruppur', 'tirupur', 'gurgaon',
  'gurugram', 'noida', 'greater noida', 'dehradun', 'kolhapur', 'ajmer', 'ulhasnagar',
  'siliguri', 'bhilai', 'cuttack', 'firozabad', 'kochi', 'cochin', 'nellore', 'jammu',
  'mangalore', 'mangaluru', 'ranchi', 'bhubaneswar', 'salem', 'warangal', 'guntur',
  'goa', 'panaji', 'shimla', 'pondicherry', 'puducherry', 'kerala', 'karnataka',
  'maharashtra', 'gujarat', 'rajasthan', 'uttar pradesh', 'punjab', 'haryana',
  'madhya pradesh', 'andhra pradesh', 'telangana', 'tamil nadu', 'west bengal',
  'odisha', 'bihar', 'jharkhand', 'assam', 'uttarakhand', 'himachal pradesh',
];

export async function findTopInfluencers(args: {
  hashtags: string[]; brandKeywords?: string[]; minFollowers?: number; maxFollowers?: number;
  minEngagementRate?: number; timeframeDays: number; influencerTier: string; limit: number;
  indianOnly?: boolean;
}) {
  const coll = getCollection('ig_hashtag_posts');
  const cutoff = new Date(Date.now() - args.timeframeDays * 86_400_000);
  const brandOr = args.brandKeywords?.length
    ? args.brandKeywords.map(kw => ({ $regexMatch: { input: '$caption', regex: kw, options: 'i' } }))
    : [{ $literal: false as const }];

  const pipeline: any[] = [
    { $match: { sourceHashtag: { $in: args.hashtags }, timestamp: { $gte: cutoff } } },
    { $group: {
      _id: '$username', totalPosts: { $sum: 1 },
      avgEngagementScore: { $avg: '$engagementScore' }, avgLikes: { $avg: '$likesCount' },
      avgComments: { $avg: '$commentsCount' },
      sponsoredCount: { $sum: { $cond: ['$isSponsored', 1, 0] } },
      brandMentionCount: { $sum: { $cond: [{ $or: brandOr }, 1, 0] } },
      topPostUrl: { $first: '$url' }, topPostScore: { $first: '$engagementScore' },
      // Collect location names from posts — use most frequent one
      locations: { $push: '$locationName' },
    }},
    { $addFields: {
      sponsoredRatio: { $cond: [{ $eq: ['$totalPosts', 0] }, 0, { $divide: ['$sponsoredCount', '$totalPosts'] }] },
      // Score: engagement weighted + brand mention bonus. Sponsored ratio reported but NOT used to exclude.
      score: { $add: [{ $multiply: ['$avgEngagementScore', 0.5] }, { $multiply: ['$brandMentionCount', 1000] }] },
    }},
    { $sort: { score: -1 } },
    // Fetch larger pool when indianOnly — we'll filter after profile enrichment
    { $limit: (args.limit ?? 10) * (args.indianOnly ? 8 : 2) },
  ];
  const candidates = await coll.aggregate(pipeline).toArray();

  // Batch-load all cached profiles in one query; only fall back to Apify for misses
  const candidateUsernames = candidates.map(c => c._id as string);
  const profileCache = await batchLoadCachedProfiles(candidateUsernames);

  // Enrich profiles in parallel — fetch enough to satisfy limit after filtering
  const enriched = await Promise.allSettled(
    candidates.map(async (c) => {
      const profile = profileCache.get(c._id as string) ?? await getOrFetchProfile(c._id as string);
      const fc = profile?.followersCount as number ?? 0;
      const engRate = fc > 0 ? ((c.avgLikes as number) + (c.avgComments as number)) / fc : null;

      // Follower filters
      if (args.minFollowers && fc < args.minFollowers) return null;
      if (args.maxFollowers && fc > args.maxFollowers) return null;
      if (args.minEngagementRate && engRate && engRate < args.minEngagementRate) return null;
      if (args.influencerTier && args.influencerTier !== 'all' && classifyTier(fc) !== args.influencerTier) return null;

      // Indian filter: check bio + post locations for India keywords
      if (args.indianOnly) {
        const bio = ((profile as any)?.bio ?? '').toLowerCase();
        const postLocations = ((c.locations as string[]) ?? []).filter(Boolean).join(' ').toLowerCase();
        const combinedText = bio + ' ' + postLocations;
        const isIndian = INDIA_LOCATIONS.some(loc => combinedText.includes(loc));
        if (!isIndian) return null;
      }

      return {
        username: c._id, tier: classifyTier(fc), followersCount: fc,
        isVerified: profile?.isVerified ?? false,
        bio: (profile as any)?.bio ?? '',
        avgEngagementScore: Math.round(c.avgEngagementScore as number),
        avgEngagementRate: engRate ? (engRate * 100).toFixed(1) + '%' : 'n/a',
        brandMentionCount: c.brandMentionCount, sponsoredRatio: Math.round((c.sponsoredRatio as number) * 100) + '%',
        totalPostsAnalysed: c.totalPosts,
        topPost: { url: c.topPostUrl, engagementScore: c.topPostScore },
      };
    })
  );

  const results = enriched
    .filter(r => r.status === 'fulfilled' && (r as PromiseFulfilledResult<any>).value !== null)
    .map((r) => (r as PromiseFulfilledResult<any>).value)
    .slice(0, args.limit ?? 10)
    .map((v, i) => ({ rank: i + 1, ...v }));

  // Auto-enroll newly discovered influencers as prospects (fire-and-forget)
  autoEnrollBatch(
    (results as Record<string, unknown>[]).map(r => ({ username: r.username as string, followersCount: r.followersCount as number, tags: ['source:find_top_influencers'] })),
    'find_top_influencers',
  ).catch(() => {});

  return { influencers: results };
}

export async function checkUserTopicPosts(args: {
  username: string; keywords: string[]; timeframeDays: number; includeReels: boolean;
}) {
  const cutoff = new Date(Date.now() - args.timeframeDays * 86_400_000);
  const colls = ['ig_posts'];
  if (args.includeReels) colls.push('ig_reels');
  const orConds = args.keywords.map(kw => ({ caption: { $regex: kw, $options: 'i' } }));

  // Query all collections in parallel — each collection does find + countDocuments concurrently too
  const collResults = await Promise.all(
    colls.map(async cn => {
      const c = getCollection(cn);
      const baseFilter = { username: args.username, timestamp: { $gte: cutoff } };
      const [docs, count] = await Promise.all([
        c.find({ ...baseFilter, $or: orConds }).sort({ timestamp: -1 }).toArray(),
        c.countDocuments(baseFilter),
      ]);
      return { docs, count };
    })
  );

  const allMatches = collResults.flatMap(r => r.docs.map(d => { const { _id, ...p } = d; return p; }));
  const totalScanned = collResults.reduce((s, r) => s + r.count, 0);
  return {
    username: args.username, matchCount: allMatches.length,
    matches: allMatches.slice(0, 20), totalScanned,
    organicMatches: allMatches.filter(m => !m.isSponsored).length,
    postingConsistency: totalScanned > 0 ? allMatches.length + '/' + totalScanned + ' posts match' : 'No posts found',
  };
}

export async function getMentionNetwork(args: {
  hashtags: string[]; minMentions?: number; minFollowers?: number; limit?: number; excludeHandles?: string[];
}) {
  const coll = getCollection('ig_hashtag_posts');
  const minMentions = args.minMentions ?? 2;
  const limit = args.limit ?? 10;
  const excludeSet = new Set((args.excludeHandles ?? []).map(h => h.toLowerCase().replace(/^@/, '')));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipeline: any[] = [
    { $match: { sourceHashtag: { $in: args.hashtags } } },
    { $unwind: '$mentionedAccounts' },
    { $group: { _id: { $toLower: { $ltrim: { input: '$mentionedAccounts', chars: '@' } } }, mentionCount: { $sum: 1 } } },
    { $match: { mentionCount: { $gte: minMentions } } },
    { $sort: { mentionCount: -1 } },
    { $limit: limit * 4 },
  ];

  const topMentioned = await coll.aggregate(pipeline).toArray();
  const filtered = topMentioned.filter(m => !excludeSet.has(m._id as string));

  // Batch-load cached profiles in one query; only fall back to Apify for misses
  const mentionUsernames = filtered.map(m => m._id as string);
  const profileCache = await batchLoadCachedProfiles(mentionUsernames);

  // Best-effort profile enrichment (Apify only on cache miss)
  const enriched = await Promise.allSettled(
    filtered.map(async (m) => {
      const profile = profileCache.get(m._id as string) ?? await getOrFetchProfile(m._id as string);
      const fc = (profile?.followersCount as number) ?? 0;
      if (args.minFollowers && fc > 0 && fc < args.minFollowers) return null;
      return {
        username: m._id,
        mentionCount: m.mentionCount as number,
        followersCount: fc,
        tier: fc > 0 ? classifyTier(fc) : 'unknown',
        isVerified: profile?.isVerified ?? false,
        bio: (profile as Record<string, unknown> | null)?.bio as string ?? '',
      };
    })
  );

  const results = enriched
    .filter(r => r.status === 'fulfilled' && (r as PromiseFulfilledResult<unknown>).value !== null)
    .map(r => (r as PromiseFulfilledResult<Record<string, unknown>>).value)
    .slice(0, limit)
    .map((v, i) => ({ rank: i + 1, ...v }));

  // Auto-enroll newly discovered influencers as prospects (fire-and-forget)
  autoEnrollBatch(
    (results as Record<string, unknown>[]).map(r => ({ username: r.username as string, followersCount: r.followersCount as number, tags: ['source:get_mention_network'] })),
    'get_mention_network',
  ).catch(() => {});

  return {
    topMentioned: results,
    totalMentionsFound: topMentioned.length,
    hashtagsQueried: args.hashtags,
  };
}
