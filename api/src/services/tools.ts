import { Schemas } from '../schemas/zod.js';
import { runActor } from './apify.js';
import { ACTORS } from '../constants/actors.js';
import { TTL } from '../constants/ttl.js';
import { transformPost, transformProfile } from './transform.js';
import { getCollection } from './mongo.js';
import { writeCache } from '../middleware/cacheFirst.js';
import { INDIA_LOCATIONS, classifyTier } from './analytics.js';
import { autoEnrollProspect, autoEnrollBatch, autoEnrollFromHashtagPosts } from './autoEnrich.js';

// ─── Phase 1: Data Fetching Tools ────────────────────────────────────

export async function executeGetProfile(raw: unknown) {
  const { username } = Schemas.get_profile.parse(raw);

  // Check cache first
  const coll = getCollection('ig_profiles');
  const cached = await coll.findOne({ username, cachedAt: { $gt: new Date(Date.now() - TTL.PROFILES) } });
  if (cached) { const { _id, ...doc } = cached; return { ...doc, cacheHit: true }; }

  const items = await runActor<Record<string, unknown>>({ actorId: ACTORS.PROFILE, input: { usernames: [username] } });
  if (!items.length) throw new ToolError(`Profile not found: ${username}`, 'NOT_FOUND');
  const profile = transformProfile(items[0]);
  await writeCache('ig_profiles', { username: profile.username }, profile as unknown as Record<string, unknown>);

  // Auto-enroll as prospect if not already tracked (fire-and-forget)
  autoEnrollProspect(profile.username, 'get_profile', { followersCount: profile.followersCount }).catch(() => {});

  return { ...profile, cacheHit: false, cachedAt: new Date().toISOString() };
}

export async function executeGetUserPosts(raw: unknown) {
  const { username, resultsLimit } = Schemas.get_user_posts.parse(raw);

  // Check cache
  const postsColl = getCollection('ig_posts');
  const cachedPosts = await postsColl.find({ username, cachedAt: { $gt: new Date(Date.now() - TTL.POSTS) } }).toArray();
  if (cachedPosts.length) {
    const posts = cachedPosts.map(d => { const { _id, ...p } = d; return p; });
    const avg = posts.length ? Math.round(posts.reduce((s, p) => s + (p.engagementScore as number), 0) / posts.length) : 0;
    return { username, posts, totalFetched: posts.length, avgEngagementScore: avg, cacheHit: true };
  }

  const items = await runActor<Record<string, unknown>>({ actorId: ACTORS.POSTS, input: { username: [username], resultsLimit } });
  const posts = items.map(p => transformPost(p));
  const ops = posts.map(p => ({ updateOne: { filter: { postId: p.postId }, update: { $set: { ...p, cachedAt: new Date() } }, upsert: true } }));
  if (ops.length) await postsColl.bulkWrite(ops, { ordered: false });
  const avg = posts.length ? Math.round(posts.reduce((s, p) => s + p.engagementScore, 0) / posts.length) : 0;
  return { username, posts, totalFetched: posts.length, avgEngagementScore: avg, cacheHit: false, cachedAt: new Date().toISOString() };
}

export async function executeGetUserReels(raw: unknown) {
  const { username, resultsLimit } = Schemas.get_user_reels.parse(raw);

  const reelsColl = getCollection('ig_reels');
  const cachedReels = await reelsColl.find({ username, cachedAt: { $gt: new Date(Date.now() - TTL.REELS) } }).toArray();
  if (cachedReels.length) {
    const reels = cachedReels.map(d => { const { _id, ...p } = d; return p; });
    const avg = reels.length ? Math.round(reels.reduce((s, p) => s + (p.playsCount as number), 0) / reels.length) : 0;
    return { username, reels, totalFetched: reels.length, avgPlaysPerReel: avg, cacheHit: true };
  }

  const items = await runActor<Record<string, unknown>>({ actorId: ACTORS.REELS, input: { username: [username], resultsLimit } });
  const reels = items.map(p => transformPost(p));
  const ops = reels.map(p => ({ updateOne: { filter: { postId: p.postId }, update: { $set: { ...p, cachedAt: new Date() } }, upsert: true } }));
  if (ops.length) await reelsColl.bulkWrite(ops, { ordered: false });
  const avg = reels.length ? Math.round(reels.reduce((s, p) => s + p.playsCount, 0) / reels.length) : 0;
  return { username, reels, totalFetched: reels.length, avgPlaysPerReel: avg, cacheHit: false, cachedAt: new Date().toISOString() };
}

export async function executeGetHashtagPosts(raw: unknown) {
  const { hashtag, resultsLimit } = Schemas.get_hashtag_posts.parse(raw);

  // Check meta cache
  const metaColl = getCollection('ig_hashtag_posts_meta');
  const meta = await metaColl.findOne({ hashtag, cachedAt: { $gt: new Date(Date.now() - TTL.HASHTAG_META) } });
  if (meta) {
    const postsColl = getCollection('ig_hashtag_posts');
    const posts = await postsColl.find({ sourceHashtag: hashtag, cachedAt: { $gt: new Date(Date.now() - TTL.HASHTAG_POSTS) } }).toArray();
    const cleaned = posts.map(d => { const { _id, ...p } = d; return p; });
    return { hashtag, posts: cleaned, totalFetched: cleaned.length, cacheHit: true };
  }

  const items = await runActor<Record<string, unknown>>({ actorId: ACTORS.HASHTAG, input: { hashtags: [hashtag], resultsLimit, onlyPostsNewerThan: '1 month' } });
  const posts = items.map(p => transformPost(p, hashtag));
  const coll = getCollection('ig_hashtag_posts');
  const ops = posts.map(p => ({ updateOne: { filter: { postId: p.postId, sourceHashtag: hashtag }, update: { $set: { ...p, cachedAt: new Date() } }, upsert: true } }));
  if (ops.length) await coll.bulkWrite(ops, { ordered: false });
  await writeCache('ig_hashtag_posts_meta', { hashtag }, { hashtag, resultsLimit, totalFetched: posts.length });

  // Auto-enroll authors from GNC hashtags as prospects (fire-and-forget)
  autoEnrollFromHashtagPosts(posts, hashtag).catch(() => {});

  return { hashtag, posts, totalFetched: posts.length, cacheHit: false, cachedAt: new Date().toISOString() };
}

export async function executeGetHashtagStats(raw: unknown) {
  const { hashtag } = Schemas.get_hashtag_stats.parse(raw);

  // Check cache
  const statsColl = getCollection('ig_hashtag_stats');
  const cached = await statsColl.findOne({ hashtag, cachedAt: { $gt: new Date(Date.now() - TTL.HASHTAG_STATS) } });
  if (cached) { const { _id, ...doc } = cached; return { ...doc, cacheHit: true }; }

  const coll = getCollection('ig_hashtag_posts');
  const pipeline = [
    { $match: { sourceHashtag: hashtag, cachedAt: { $gt: new Date(Date.now() - TTL.HASHTAG_POSTS) } } },
    { $group: {
      _id: '$sourceHashtag',
      totalPostCount: { $sum: 1 },
      avgLikesPerPost: { $avg: '$likesCount' },
      avgCommentsPerPost: { $avg: '$commentsCount' },
      avgEngagementScore: { $avg: '$engagementScore' },
      topCreators: { $addToSet: '$username' },
      sampleSize: { $sum: 1 },
      minTs: { $min: '$timestamp' },
      maxTs: { $max: '$timestamp' },
    }},
  ];
  const results = await coll.aggregate(pipeline).toArray();
  if (!results.length) throw new ToolError(`No cached data for #${hashtag}. Call get_hashtag_posts first.`, 'NOT_FOUND');
  const r = results[0];
  const daySpan = Math.max(1, (new Date(r.maxTs as string).getTime() - new Date(r.minTs as string).getTime()) / 86_400_000);
  const stats = {
    hashtag,
    totalPostCount: r.totalPostCount as number,
    recentPostsPerDay: Math.round(((r.totalPostCount as number) / daySpan) * 10) / 10,
    avgLikesPerPost: Math.round(r.avgLikesPerPost as number),
    avgCommentsPerPost: Math.round(r.avgCommentsPerPost as number),
    avgEngagementScore: Math.round(r.avgEngagementScore as number),
    topCreators: (r.topCreators as string[]).slice(0, 10),
    peakPostingHour: 'n/a',
    sampleSize: r.sampleSize as number,
  };
  await writeCache('ig_hashtag_stats', { hashtag }, stats);
  return { ...stats, cacheHit: false, cachedAt: new Date().toISOString() };
}

export async function executeCheckPost(raw: unknown) {
  const { postUrl } = Schemas.check_post.parse(raw);

  // Query all three caches in parallel — first hit wins
  const [postDoc, reelDoc, hashtagDoc] = await Promise.all([
    getCollection('ig_posts').findOne({ url: postUrl }),
    getCollection('ig_reels').findOne({ url: postUrl }),
    getCollection('ig_hashtag_posts').findOne({ url: postUrl }),
  ]);
  const cached = postDoc ?? reelDoc ?? hashtagDoc;
  if (cached) {
    const { _id, ...post } = cached;
    const hoursOld = Math.round((Date.now() - new Date(post.timestamp as string).getTime()) / 3_600_000);
    return { ...post, isLive: true, hoursOld, cacheHit: true };
  }

  // Actor requires a valid username to establish its Instagram session
  const shortcode = postUrl.match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/)?.[2] ?? null;
  const rawItems = await runActor<Record<string, unknown>>({ actorId: ACTORS.POSTS, input: { directUrls: [postUrl], username: ['gnclivewell'], resultsLimit: 30 } });
  const validItems = rawItems.filter(i => !i.error);
  const items = shortcode
    ? validItems.filter(i => {
        const sc = (i.shortCode ?? i.id ?? '') as string;
        const u = (i.url ?? '') as string;
        return sc === shortcode || u.includes(shortcode);
      })
    : validItems;
  if (!items.length) throw new ToolError('Post not found', 'NOT_FOUND');
  const post = transformPost(items[0]);
  await getCollection('ig_posts').updateOne({ postId: post.postId }, { $set: { ...post, cachedAt: new Date() } }, { upsert: true });
  const hoursOld = Math.round((Date.now() - new Date(post.timestamp).getTime()) / 3_600_000);
  return { ...post, isLive: true, hoursOld, cacheHit: false, cachedAt: new Date().toISOString() };
}

// ─── Discover Influencers via Google Search ──────────────────────────

// Parse follower count from Google snippet text e.g. "1M followers", "596K followers", "11.5M followers"
function parseFollowerCount(text: string): number {
  const m = text.match(/(\d+(?:\.\d+)?)\s*([KMB]?)\s*followers/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const suffix = m[2].toUpperCase();
  if (suffix === 'B') return Math.round(n * 1_000_000_000);
  if (suffix === 'M') return Math.round(n * 1_000_000);
  if (suffix === 'K') return Math.round(n * 1_000);
  return Math.round(n);
}

// Extract username from instagram.com/{username}/ URL
function extractUsername(url: string): string | null {
  const m = url.match(/instagram\.com\/([A-Za-z0-9_.]+)\/?$/);
  if (!m) return null;
  const u = m[1].toLowerCase();
  // Skip non-profile paths
  if (['p', 'reel', 'tv', 'explore', 'accounts', 'stories'].includes(u)) return null;
  return u;
}

// Handles to skip — platform names and generic terms that appear as Instagram usernames
const SKIP_HANDLES = new Set(['instagram', 'facebook', 'twitter', 'youtube', 'tiktok', 'gnc', 'sponsored', 'ad']);

export async function executeDiscoverInfluencers(raw: unknown) {
  const { niche, country, minFollowers, limit } = Schemas.discover_influencers.parse(raw);

  const maxResults = limit;
  const minF = minFollowers;
  const geo = country;

  // 6 targeted Google queries for maximum coverage
  const queries = [
    `site:instagram.com "${niche}" "${geo}" influencer fitness`,
    `site:instagram.com "${niche}" "${geo}" trainer bodybuilder`,
    `top ${geo} ${niche} instagram influencers 2024 2025`,
    `"brand ambassador" "${niche}" "${geo}" instagram`,
    `site:linktr.ee "${niche}" ${geo} fitness instagram`,
    `${geo} ${niche} instagram mega influencer followers`,
  ].join('\n');

  const items = await runActor<Record<string, unknown>>({
    actorId: ACTORS.GOOGLE_SEARCH,
    input: {
      queries,
      resultsPerPage: 10,
      maxPagesPerQuery: 1,
      countryCode: 'in',
      languageCode: 'en',
    },
    timeoutSecs: 90,
    memoryMbytes: 512,
  });

  // Pass 1: Collect unique profile URLs with follower hints from snippet
  const seen = new Set<string>();
  const candidates: { username: string; followerHint: number; description: string; url: string }[] = [];

  for (const item of items) {
    const organic = (item.organicResults as Record<string, unknown>[]) ?? [];
    for (const r of organic) {
      const url = (r.url as string) ?? '';
      const desc = (r.description as string) ?? '';
      const title = (r.title as string) ?? '';
      const username = extractUsername(url);
      if (username && !seen.has(username) && !SKIP_HANDLES.has(username)) {
        seen.add(username);
        const followerHint = parseFollowerCount(desc) || parseFollowerCount(title);
        if (minF > 0 && followerHint > 0 && followerHint < minF) continue;
        candidates.push({ username, followerHint, description: desc, url });
      }

      // Pass 2: Extract @mentions from title + description to catch handles in article snippets
      const text = title + ' ' + desc;
      const atMentionRe = /@([A-Za-z0-9_.]{2,50})/g;
      let match: RegExpExecArray | null;
      // eslint-disable-next-line no-cond-assign
      while ((match = atMentionRe.exec(text)) !== null) {
        const u = match[1].toLowerCase();
        if (!seen.has(u) && !SKIP_HANDLES.has(u)) {
          seen.add(u);
          candidates.push({ username: u, followerHint: 0, description: '', url: `https://www.instagram.com/${u}/` });
        }
      }
    }
  }

  if (!candidates.length) {
    return { influencers: [], totalDiscovered: 0, queriesRun: 6 };
  }

  // Fetch full profiles — use 4x pool to have room for filtering
  const toFetch = candidates.slice(0, maxResults * 4);
  const profileItems = await runActor<Record<string, unknown>>({
    actorId: ACTORS.PROFILE,
    input: { usernames: toFetch.map(c => c.username) },
    timeoutSecs: 120,
    memoryMbytes: 512,
  });

  // Map profiles back, apply minFollowers filter, sort by followers desc
  const profileMap = new Map<string, ReturnType<typeof transformProfile>>();
  for (const p of profileItems) {
    const profile = transformProfile(p);
    if (profile.username) profileMap.set(profile.username, profile);
    // fire-and-forget — cache write doesn't need to block the response
    writeCache('ig_profiles', { username: profile.username }, profile as unknown as Record<string, unknown>).catch(() => {});
  }

  const results = toFetch
    .map(c => {
      const profile = profileMap.get(c.username);
      const fc = profile?.followersCount ?? c.followerHint;
      return {
        username: c.username,
        tier: classifyTier(fc),
        followersCount: fc,
        followerHint: c.followerHint,
        fullName: profile?.fullName ?? '',
        bio: (profile as Record<string, unknown> | undefined)?.bio as string ?? c.description,
        isVerified: profile?.isVerified ?? false,
        postsCount: profile?.postsCount ?? 0,
        profileUrl: `https://www.instagram.com/${c.username}/`,
      };
    })
    .filter(r => r.followersCount >= minF)
    .sort((a, b) => b.followersCount - a.followersCount)
    .slice(0, maxResults)
    .map((r, i) => ({ rank: i + 1, ...r }));

  // Auto-enroll all discovered influencers as prospects (fire-and-forget)
  autoEnrollBatch(
    results.map(r => ({ username: r.username as string, followersCount: r.followersCount as number, tags: [`niche:${niche}`, `country:${geo}`] })),
    'discover_influencers',
  ).catch(() => {});

  return {
    influencers: results,
    totalDiscovered: candidates.length,
    queriesRun: 6,
  };
}

export async function executeExpandNetwork(raw: unknown) {
  const { seeds, minFollowers, country, limit } = Schemas.expand_network.parse(raw);
  const geo = country.toLowerCase();

  // Fetch seed profiles to extract relatedProfiles
  const seedItems = await runActor<Record<string, unknown>>({
    actorId: ACTORS.PROFILE,
    input: { usernames: seeds },
    timeoutSecs: 90,
    memoryMbytes: 512,
  });

  const relatedUsernames = new Set<string>();
  let hasRelatedProfiles = false;

  for (const item of seedItems) {
    const related = (item.relatedProfiles as Record<string, unknown>[]) ?? [];
    if (related.length) {
      hasRelatedProfiles = true;
      for (const rp of related) {
        const u = ((rp.username as string) ?? '').toLowerCase().replace(/^@/, '');
        if (u && !seeds.includes(u) && !SKIP_HANDLES.has(u)) relatedUsernames.add(u);
      }
    }
  }

  if (!hasRelatedProfiles || !relatedUsernames.size) {
    return {
      influencers: [],
      note: 'No relatedProfiles returned by Apify for these seeds. Try discover_influencers or get_mention_network for alternative discovery paths.',
      seeds,
    };
  }

  // Fetch full profiles for related accounts (3x pool for filtering headroom)
  const toFetch = Array.from(relatedUsernames).slice(0, limit * 3);
  const profileItems = await runActor<Record<string, unknown>>({
    actorId: ACTORS.PROFILE,
    input: { usernames: toFetch },
    timeoutSecs: 120,
    memoryMbytes: 512,
  });

  const results: Record<string, unknown>[] = [];
  for (const p of profileItems) {
    const profile = transformProfile(p);
    const fc = profile.followersCount ?? 0;
    if (minFollowers && fc < minFollowers) continue;

    // Country filter via bio — skip for mega accounts (1M+) where bio may be sparse
    if (geo !== 'all') {
      const bioText = ((profile as unknown as Record<string, unknown>).bio as string ?? '').toLowerCase();
      const isTargetCountry = geo === 'india'
        ? INDIA_LOCATIONS.some(loc => bioText.includes(loc))
        : bioText.includes(geo);
      if (!isTargetCountry && fc < 1_000_000) continue;
    }

    writeCache('ig_profiles', { username: profile.username }, profile as unknown as Record<string, unknown>).catch(() => {});
    results.push({
      username: profile.username,
      tier: classifyTier(fc),
      followersCount: fc,
      fullName: profile.fullName ?? '',
      bio: (profile as unknown as Record<string, unknown>).bio as string ?? '',
      isVerified: profile.isVerified ?? false,
      profileUrl: `https://www.instagram.com/${profile.username}/`,
    });
  }

  results.sort((a, b) => (b.followersCount as number) - (a.followersCount as number));
  const ranked = results.slice(0, limit).map((r, i) => ({ rank: i + 1, ...r }));

  // Auto-enroll newly discovered influencers as prospects (fire-and-forget)
  autoEnrollBatch(
    (ranked as Record<string, unknown>[]).map(r => ({ username: r.username as string, followersCount: r.followersCount as number, tags: ['source:expand_network', `seeds:${seeds.slice(0, 3).join(',')}`] })),
    'expand_network',
  ).catch(() => {});

  return {
    influencers: ranked,
    seeds,
    totalRelatedFound: relatedUsernames.size,
    signal: 'instagram_related_profiles',
  };
}

// ─── Error class for tool failures ──────────────────────────────────

export class ToolError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
  }
}
