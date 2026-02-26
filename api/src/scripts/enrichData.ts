/**
 * enrichData.ts
 *
 * Comprehensive data enrichment in 4 phases:
 *   Phase 1 — GNC hashtags (#gnc, #gnclivewell, #gncfitness, etc.)
 *             → mine posts, find creators, filter 30k+, enrich influencer_records
 *   Phase 2 — GNC affiliated creators (mentioned in @gnclivewell / @guardiangnc posts)
 *             → deeper scrape with reels included, re-enrich profiles
 *   Phase 3 — Competitor brands (MuscleBlaze, ON, MyProtein, etc.)
 *             → mine posts, tag creators as competitor-aware targets
 *   Phase 4 — Register organic GNC-tagged posts under campaign
 *             → any 30k+ creator post that tags #gnclivewell gets registered
 */

import { connectDB, closeDB, getCollection } from '../services/mongo.js';
import { runActor } from '../services/apify.js';
import { ACTORS } from '../constants/actors.js';
import { transformPost, transformProfile } from '../services/transform.js';
import { writeCache } from '../middleware/cacheFirst.js';
import { classifyTier } from '../services/analytics.js';
import type { InfluencerRecord } from '../schemas/types.js';

// ─── Config ──────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run');
const MIN_FOLLOWERS = 30_000;
const HASHTAG_LIMIT = 100;   // posts per hashtag fetch
const PROFILE_BATCH = 25;    // usernames per profile-scraper call

const GNC_HANDLES = ['gnclivewell', 'guardiangnc'];

const GNC_HASHTAGS = ['gnclivewell', 'gncfitness', 'gncindia', 'gncprotein', 'gnc'];

// Competitor brand → their primary hashtags
const COMPETITOR_HASHTAGS: Record<string, string[]> = {
  muscleblaze:       ['muscleblaze', 'muscleblazeindia', 'mbnutrition'],
  optimum_nutrition: ['optimumnutrition', 'ongold', 'onwhey'],
  myprotein:         ['myprotein', 'myproteinin'],
  dymatize:          ['dymatize', 'dymatizeindia'],
  healthkart:        ['healthkart'],
  asitis:            ['asitisnutrition', 'asitis'],
  nakpro:            ['nakpro'],
  bigmuscles:        ['bigmusclesnutrition'],
};

// Campaign to register organic GNC posts under
const CAMPAIGN_ID = 'gnc-summer-fitness-2025';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

interface CreatorSummary {
  postCount: number;
  totalEngagement: number;
  topPostUrl: string;
  topEngagement: number;
  hashtags: string[];
}

/**
 * Fetch a hashtag via Apify, write to ig_hashtag_posts, return per-creator aggregation
 */
async function mineHashtag(hashtag: string): Promise<Map<string, CreatorSummary>> {
  console.log(`    #${hashtag} — fetching...`);
  let items: Record<string, unknown>[] = [];
  try {
    items = await runActor<Record<string, unknown>>({
      actorId: ACTORS.HASHTAG,
      input: { hashtags: [hashtag], resultsLimit: HASHTAG_LIMIT, onlyPostsNewerThan: '3 months' },
    });
  } catch (err) {
    console.error(`    #${hashtag} failed: ${err instanceof Error ? err.message : err}`);
    return new Map();
  }

  const posts = items.map(p => transformPost(p, hashtag));

  if (!DRY_RUN && posts.length) {
    const coll = getCollection('ig_hashtag_posts');
    const ops = posts.map(p => ({
      updateOne: {
        filter: { postId: p.postId, sourceHashtag: hashtag },
        update: { $set: { ...p, cachedAt: new Date() } },
        upsert: true,
      },
    }));
    await coll.bulkWrite(ops, { ordered: false });
    await writeCache('ig_hashtag_posts_meta', { hashtag }, { hashtag, resultsLimit: HASHTAG_LIMIT, totalFetched: posts.length });
  }

  // Aggregate by creator
  const map = new Map<string, CreatorSummary>();
  for (const post of posts) {
    const u = post.username;
    if (!u) continue;
    const prev = map.get(u) ?? { postCount: 0, totalEngagement: 0, topPostUrl: '', topEngagement: 0, hashtags: [] };
    prev.postCount++;
    prev.totalEngagement += post.engagementScore;
    if (post.engagementScore > prev.topEngagement) {
      prev.topEngagement = post.engagementScore;
      prev.topPostUrl = post.url;
    }
    if (!prev.hashtags.includes(hashtag)) prev.hashtags.push(hashtag);
    map.set(u, prev);
  }

  console.log(`    #${hashtag} → ${posts.length} posts, ${map.size} unique creators`);
  return map;
}

/**
 * Fetch user posts and extract mentioned usernames
 */
async function scrapeUserMentions(handle: string): Promise<string[]> {
  console.log(`    @${handle} — scraping posts for mentions...`);
  try {
    const items = await runActor<Record<string, unknown>>({
      actorId: ACTORS.POSTS,
      input: { username: [handle], resultsLimit: 50 },
    });
    const mentioned = new Set<string>();
    for (const item of items) {
      const post = transformPost(item);
      for (const m of post.mentionedAccounts) {
        const clean = m.toLowerCase().replace(/^@/, '');
        if (!GNC_HANDLES.includes(clean) && clean.length > 1) mentioned.add(clean);
      }
    }
    // Also scrape reels
    const reelItems = await runActor<Record<string, unknown>>({
      actorId: ACTORS.REELS,
      input: { username: [handle], resultsLimit: 30 },
    });
    for (const item of reelItems) {
      const post = transformPost(item);
      for (const m of post.mentionedAccounts) {
        const clean = m.toLowerCase().replace(/^@/, '');
        if (!GNC_HANDLES.includes(clean) && clean.length > 1) mentioned.add(clean);
      }
    }
    console.log(`    @${handle} → ${mentioned.size} unique mentions`);
    return Array.from(mentioned);
  } catch (err) {
    console.error(`    @${handle} failed: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

/**
 * Fetch profiles in batches, cache them, return map of username → raw profile
 */
async function fetchProfiles(usernames: string[]): Promise<Map<string, ReturnType<typeof transformProfile>>> {
  const profileMap = new Map<string, ReturnType<typeof transformProfile>>();
  const total = Math.ceil(usernames.length / PROFILE_BATCH);

  for (let i = 0; i < usernames.length; i += PROFILE_BATCH) {
    const batch = usernames.slice(i, i + PROFILE_BATCH);
    const batchNum = Math.floor(i / PROFILE_BATCH) + 1;
    console.log(`    Profile batch ${batchNum}/${total} (${batch.length} accounts)...`);
    try {
      const items = await runActor<Record<string, unknown>>({
        actorId: ACTORS.PROFILE,
        input: { usernames: batch },
        timeoutSecs: 180,
        memoryMbytes: 512,
      });
      for (const item of items) {
        const profile = transformProfile(item);
        profileMap.set(profile.username, profile);
        if (!DRY_RUN) {
          writeCache('ig_profiles', { username: profile.username }, profile as unknown as Record<string, unknown>).catch(() => {});
        }
      }
    } catch (err) {
      console.error(`    Batch ${batchNum} failed: ${err instanceof Error ? err.message : err}`);
    }
    if (i + PROFILE_BATCH < usernames.length) await sleep(2000);
  }

  return profileMap;
}

/**
 * Upsert influencer_records with tags, skip below MIN_FOLLOWERS
 */
async function upsertInfluencers(
  candidates: Map<string, CreatorSummary>,
  profileMap: Map<string, ReturnType<typeof transformProfile>>,
  tags: string[],
): Promise<{ added: number; updated: number; skipped: number }> {
  const coll = getCollection<InfluencerRecord>('influencer_records');
  const now = new Date();
  let added = 0; let updated = 0; let skipped = 0;

  for (const [username, summary] of candidates) {
    const profile = profileMap.get(username);
    const followers = profile?.followersCount ?? 0;

    if (followers < MIN_FOLLOWERS) { skipped++; continue; }

    const tier = classifyTier(followers);
    const note = `Discovered via ${summary.hashtags.join(', ')} — ${summary.postCount} posts, avg eng ${Math.round(summary.totalEngagement / summary.postCount)}`;

    if (DRY_RUN) {
      console.log(`    [DRY RUN] @${username} — ${followers.toLocaleString()} followers (${tier})`);
      added++;
      continue;
    }

    const existing = await coll.findOne({ username });
    if (existing) {
      await coll.updateOne(
        { username },
        {
          $set: { updatedAt: now },
          $addToSet: { tags: { $each: tags }, notes: note },
        },
      );
      updated++;
    } else {
      await coll.insertOne({
        username,
        lifecycleStatus: 'prospect',
        collaborationHistory: [],
        totalCollaborations: 0,
        lastCollaborationDate: null,
        averagePerformanceScore: null,
        complianceViolations: 0,
        notes: [note],
        tags: [...tags, tier],
        createdAt: now,
        updatedAt: now,
      } as InfluencerRecord);
      added++;
    }
  }

  return { added, updated, skipped };
}

/**
 * Register a post URL under the GNC campaign (skip if already registered)
 */
async function registerPost(postUrl: string): Promise<'registered' | 'duplicate' | 'error'> {
  try {
    const existing = await getCollection('campaign_posts').findOne({ campaignId: CAMPAIGN_ID, postUrl });
    if (existing) return 'duplicate';

    const items = await runActor<Record<string, unknown>>({
      actorId: ACTORS.POSTS,
      input: { directUrls: [postUrl], username: ['_'], resultsLimit: 1 },
    });
    if (!items.length) return 'error';

    const post = transformPost(items[0]);
    const snapshot = {
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
    const campaignDoc = {
      campaignId: CAMPAIGN_ID,
      postUrl,
      postId: post.postId,
      username: post.username,
      platform: 'instagram' as const,
      postType: post.playsCount > 0 ? 'reel' as const : 'post' as const,
      status: 'live' as const,
      complianceStatus: 'pending_review' as const,
      complianceIssues: [] as string[],
      initialSnapshot: snapshot,
      latestSnapshot: snapshot,
      registeredAt: new Date(),
      lastCheckedAt: new Date(),
    };
    await getCollection('campaign_posts').updateOne(
      { campaignId: CAMPAIGN_ID, postUrl },
      { $set: campaignDoc },
      { upsert: true },
    );
    await getCollection('post_snapshots').insertOne({
      postId: post.postId, postUrl, capturedAt: new Date(),
      caption: post.caption, hashtags: post.hashtags, mentionedAccounts: post.mentionedAccounts,
      likesCount: post.likesCount, commentsCount: post.commentsCount,
      viewsCount: post.viewsCount, playsCount: post.playsCount,
      engagementScore: post.engagementScore, isLive: true,
      captionChanged: false, hashtagsChanged: false, tagsChanged: false,
    });
    return 'registered';
  } catch {
    return 'error';
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  await connectDB();
  console.log(`\n${'='.repeat(60)}`);
  console.log('GNC Data Enrichment Script');
  console.log(`Min followers: ${MIN_FOLLOWERS.toLocaleString()} | Posts per hashtag: ${HASHTAG_LIMIT}`);
  console.log(DRY_RUN ? '*** DRY RUN — no writes ***' : '*** LIVE — writing to MongoDB ***');
  console.log('='.repeat(60));

  // ── Phase 1: GNC Hashtags ─────────────────────────────────────────────────
  console.log('\n📌 PHASE 1: GNC Hashtags');
  const gncCreators = new Map<string, CreatorSummary>();
  const gncTopPosts: { username: string; postUrl: string; engagement: number }[] = [];

  for (const hashtag of GNC_HASHTAGS) {
    const map = await mineHashtag(hashtag);
    for (const [username, summary] of map) {
      const prev = gncCreators.get(username);
      if (prev) {
        prev.postCount += summary.postCount;
        prev.totalEngagement += summary.totalEngagement;
        prev.hashtags.push(...summary.hashtags.filter(h => !prev.hashtags.includes(h)));
        if (summary.topEngagement > prev.topEngagement) {
          prev.topEngagement = summary.topEngagement;
          prev.topPostUrl = summary.topPostUrl;
        }
      } else {
        gncCreators.set(username, { ...summary });
      }
      // Collect top posts from #gnclivewell specifically for campaign registration
      if (hashtag === 'gnclivewell' && summary.topPostUrl && summary.topEngagement > 1000) {
        gncTopPosts.push({ username, postUrl: summary.topPostUrl, engagement: summary.topEngagement });
      }
    }
    await sleep(1500);
  }

  console.log(`\n  Total unique GNC hashtag creators: ${gncCreators.size}`);
  console.log(`  Top posts to register: ${gncTopPosts.length}`);

  // Fetch profiles for GNC creators
  console.log('\n  Fetching profiles for GNC creators...');
  const gncUsernames = Array.from(gncCreators.keys()).filter(u => !GNC_HANDLES.includes(u));
  const gncProfiles = await fetchProfiles(gncUsernames);

  // Upsert to influencer_records
  console.log('\n  Upserting GNC influencer records...');
  const gncResult = await upsertInfluencers(gncCreators, gncProfiles, ['gnc-organic', 'hashtag-discovered']);
  console.log(`  → added: ${gncResult.added}, updated: ${gncResult.updated}, skipped (< ${MIN_FOLLOWERS.toLocaleString()}): ${gncResult.skipped}`);

  // ── Phase 2: Affiliated Creators (GNC handle mentions) ───────────────────
  console.log('\n📌 PHASE 2: Affiliated Creators (from GNC handle posts + reels)');
  const affiliateMentions = new Set<string>();
  for (const handle of GNC_HANDLES) {
    const mentions = await scrapeUserMentions(handle);
    mentions.forEach(m => affiliateMentions.add(m));
    await sleep(1500);
  }

  console.log(`\n  Total unique affiliate mentions: ${affiliateMentions.size}`);
  console.log('  Fetching affiliate profiles...');
  const affiliateUsernames = Array.from(affiliateMentions);
  const affiliateProfiles = await fetchProfiles(affiliateUsernames);

  // Build summary map (set postCount=1 as placeholder — we discovered via mentions, not posts)
  const affiliateMap = new Map<string, CreatorSummary>(
    affiliateUsernames.map(u => [u, { postCount: 1, totalEngagement: 0, topPostUrl: '', topEngagement: 0, hashtags: ['gnc-mentioned'] }])
  );

  const affiliateResult = await upsertInfluencers(affiliateMap, affiliateProfiles, ['gnc-affiliated', 'handle-mentioned']);
  console.log(`  → added: ${affiliateResult.added}, updated: ${affiliateResult.updated}, skipped (< ${MIN_FOLLOWERS.toLocaleString()}): ${affiliateResult.skipped}`);

  // ── Phase 3: Competitor Brands ────────────────────────────────────────────
  console.log('\n📌 PHASE 3: Competitor Brand Creators');
  const competitorCreators = new Map<string, CreatorSummary & { brand: string }>();

  for (const [brand, hashtags] of Object.entries(COMPETITOR_HASHTAGS)) {
    console.log(`\n  Brand: ${brand.toUpperCase()}`);
    const brandMap = new Map<string, CreatorSummary>();

    for (const hashtag of hashtags) {
      const map = await mineHashtag(hashtag);
      for (const [username, summary] of map) {
        const prev = brandMap.get(username);
        if (prev) {
          prev.postCount += summary.postCount;
          prev.totalEngagement += summary.totalEngagement;
          prev.hashtags.push(...summary.hashtags.filter(h => !prev.hashtags.includes(h)));
        } else {
          brandMap.set(username, { ...summary });
        }
      }
      await sleep(1500);
    }

    console.log(`    ${brand}: ${brandMap.size} unique creators`);

    // Fetch profiles
    const brandUsernames = Array.from(brandMap.keys()).filter(u => !GNC_HANDLES.includes(u));
    const brandProfiles = await fetchProfiles(brandUsernames);

    // Upsert with competitor brand tags
    const competitorResult = await upsertInfluencers(brandMap, brandProfiles, [`competitor-${brand}`, 'competitor-creator']);
    console.log(`    → added: ${competitorResult.added}, updated: ${competitorResult.updated}, skipped: ${competitorResult.skipped}`);

    await sleep(2000);
  }

  // ── Phase 4: Register Organic GNC Posts Under Campaign ───────────────────
  console.log('\n📌 PHASE 4: Registering Organic #gnclivewell Posts Under Campaign');

  // Sort by engagement descending, take top 30
  const topPosts = gncTopPosts
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 30);

  console.log(`  Registering top ${topPosts.length} posts from #gnclivewell creators...`);
  let postsRegistered = 0; let postsDuplicate = 0; let postsError = 0;

  for (const { username, postUrl, engagement } of topPosts) {
    if (!postUrl) continue;
    const profile = gncProfiles.get(username);
    const followers = profile?.followersCount ?? 0;
    if (followers < MIN_FOLLOWERS) continue;

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would register ${postUrl} (@${username}, ${followers.toLocaleString()} followers, eng: ${engagement})`);
      postsRegistered++;
      continue;
    }

    const result = await registerPost(postUrl);
    if (result === 'registered') { postsRegistered++; console.log(`  ✓ @${username} — ${postUrl}`); }
    else if (result === 'duplicate') { postsDuplicate++; }
    else { postsError++; console.log(`  ✗ @${username} — ${postUrl}`); }
    await sleep(1500);
  }

  console.log(`  → registered: ${postsRegistered}, duplicates: ${postsDuplicate}, errors: ${postsError}`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(60)}`);
  console.log('ENRICHMENT COMPLETE');
  console.log('='.repeat(60));

  const totalInfluencers = await getCollection('influencer_records').countDocuments();
  const totalCampaignPosts = await getCollection('campaign_posts').countDocuments();
  const totalHashtagPosts = await getCollection('ig_hashtag_posts').countDocuments();

  console.log(`\nMongoDB state:`);
  console.log(`  influencer_records : ${totalInfluencers}`);
  console.log(`  campaign_posts     : ${totalCampaignPosts}`);
  console.log(`  ig_hashtag_posts   : ${totalHashtagPosts}`);

  await closeDB();
}

main().catch(err => {
  console.error('Enrichment failed:', err);
  process.exit(1);
});
