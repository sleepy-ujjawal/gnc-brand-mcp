/**
 * loadDemoData.ts
 *
 * Inserts profiles and posts directly into MongoDB — no Apify scraping needed.
 * Use this before a hackathon/demo to pre-populate data that all analytics tools
 * can query instantly from cache.
 *
 * Usage:
 *   npm run demo:load                  — loads from seed-data/demo-profiles.json + demo-posts.json
 *   npm run demo:load -- --dry-run     — prints what would be inserted without writing
 *
 * Schema reference for demo-profiles.json:
 *   [{ username, fullName, bio, followersCount, followingCount, postsCount, isVerified }]
 *
 * Schema reference for demo-posts.json:
 *   [{ username, caption, likesCount, commentsCount, viewsCount, playsCount,
 *      type ("post"|"reel"), url, sourceHashtag (optional), timestamp (ISO string) }]
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { connectDB, closeDB, getCollection } from '../services/mongo.js';

const DRY_RUN = process.argv.includes('--dry-run');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function engagementScore(likes: number, comments: number, views: number, plays: number) {
  return likes + comments + views * 0.1 + plays * 0.1;
}

function parseHashtags(caption: string): string[] {
  return (caption.match(/#[\w]+/g) ?? []).map(h => h.toLowerCase());
}

function parseMentions(caption: string): string[] {
  return (caption.match(/@[\w.]+/g) ?? []).map(m => m.toLowerCase());
}

// ─── Load profiles ────────────────────────────────────────────────────────────

async function loadProfiles(dataPath: string) {
  if (!existsSync(dataPath)) {
    console.log('  No demo-profiles.json found — skipping profiles');
    return;
  }

  const raw = JSON.parse(readFileSync(dataPath, 'utf-8')) as Array<{
    username: string; fullName?: string; bio?: string;
    followersCount: number; followingCount?: number; postsCount?: number;
    isVerified?: boolean; profilePicUrl?: string;
  }>;

  const coll = getCollection('ig_profiles');
  let inserted = 0;

  for (const item of raw) {
    const doc = {
      username: item.username.toLowerCase().replace(/^@/, ''),
      fullName: item.fullName ?? '',
      bio: item.bio ?? '',
      followersCount: item.followersCount,
      followingCount: item.followingCount ?? 0,
      postsCount: item.postsCount ?? 0,
      isVerified: item.isVerified ?? false,
      profilePicUrl: item.profilePicUrl ?? '',
      externalUrl: '',
      cachedAt: new Date(),
    };

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Profile: @${doc.username} (${doc.followersCount.toLocaleString()} followers)`);
    } else {
      await coll.updateOne({ username: doc.username }, { $set: doc }, { upsert: true });
      console.log(`  ✓ Profile: @${doc.username} (${doc.followersCount.toLocaleString()} followers)`);
      inserted++;
    }
  }

  if (!DRY_RUN) console.log(`  → ${inserted} profiles upserted`);
}

// ─── Load posts ───────────────────────────────────────────────────────────────

async function loadPosts(dataPath: string) {
  if (!existsSync(dataPath)) {
    console.log('  No demo-posts.json found — skipping posts');
    return;
  }

  const raw = JSON.parse(readFileSync(dataPath, 'utf-8')) as Array<{
    username: string; caption: string;
    likesCount?: number; commentsCount?: number;
    viewsCount?: number; playsCount?: number;
    type?: 'post' | 'reel'; url?: string;
    sourceHashtag?: string; timestamp?: string;
  }>;

  const now = new Date();
  let postInserted = 0;
  let hashtagInserted = 0;

  for (const item of raw) {
    const username = item.username.toLowerCase().replace(/^@/, '');
    const likes = item.likesCount ?? 0;
    const comments = item.commentsCount ?? 0;
    const views = item.viewsCount ?? 0;
    const plays = item.playsCount ?? 0;
    const score = engagementScore(likes, comments, views, plays);
    const caption = item.caption ?? '';
    const type = item.type ?? (plays > 0 ? 'reel' : 'post');
    const timestamp = item.timestamp ? new Date(item.timestamp) : now;
    // Generate a stable postId from username + url or caption snippet
    const postId = (item.url ?? `${username}-${caption.slice(0, 20)}`).replace(/[^a-z0-9]/gi, '-');
    const url = item.url ?? `https://www.instagram.com/${username}/`;

    const baseDoc = {
      postId,
      username,
      type,
      caption,
      hashtags: parseHashtags(caption),
      mentionedAccounts: parseMentions(caption),
      likesCount: likes,
      commentsCount: comments,
      viewsCount: views,
      playsCount: plays,
      engagementScore: score,
      isSponsored: /paid partnership|#ad\b|#sponsored/i.test(caption),
      timestamp,
      url,
      cachedAt: now,
    };

    if (item.sourceHashtag) {
      // Insert into ig_hashtag_posts
      const hashtagDoc = { ...baseDoc, sourceHashtag: item.sourceHashtag.toLowerCase().replace(/^#/, '') };
      if (DRY_RUN) {
        console.log(`  [DRY RUN] HashtagPost: @${username} → #${hashtagDoc.sourceHashtag} eng=${Math.round(score)}`);
      } else {
        const coll = getCollection('ig_hashtag_posts');
        await coll.updateOne({ postId, sourceHashtag: hashtagDoc.sourceHashtag }, { $set: hashtagDoc }, { upsert: true });
        hashtagInserted++;
      }
    } else {
      // Insert into ig_posts or ig_reels
      const collName = type === 'reel' ? 'ig_reels' : 'ig_posts';
      if (DRY_RUN) {
        console.log(`  [DRY RUN] ${type === 'reel' ? 'Reel' : 'Post'}: @${username} plays=${plays} eng=${Math.round(score)}`);
      } else {
        const coll = getCollection(collName);
        await coll.updateOne({ postId }, { $set: baseDoc }, { upsert: true });
        postInserted++;
      }
    }
  }

  if (!DRY_RUN) console.log(`  → ${postInserted} posts/reels + ${hashtagInserted} hashtag posts upserted`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  await connectDB();
  console.log(`Loading demo data... ${DRY_RUN ? '(DRY RUN)' : ''}\n`);

  const seedDir = join(__dirname, 'seed-data');

  console.log('Profiles:');
  await loadProfiles(join(seedDir, 'demo-profiles.json'));

  console.log('\nPosts:');
  await loadPosts(join(seedDir, 'demo-posts.json'));

  await closeDB();
  console.log('\nDone. All data is now cached and ready for demo queries.');
}

main().catch(err => {
  console.error('Failed to load demo data:', err);
  process.exit(1);
});
