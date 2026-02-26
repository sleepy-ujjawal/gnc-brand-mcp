import { connectDB, closeDB, getCollection } from '../services/mongo.js';
import { TTL_SECONDS } from '../constants/ttl.js';

// Helper: drop a TTL index if it exists, then create with new expireAfterSeconds
async function recreateTTLIndex(collectionName: string, field: string, expireAfterSeconds: number) {
  const coll = getCollection(collectionName);
  try {
    // Try to drop existing TTL index on this field
    await coll.dropIndex(`${field}_1`);
  } catch {
    // Index may not exist — that's fine
  }
  await coll.createIndex({ [field]: 1 }, { expireAfterSeconds });
}

async function createIndexes() {
  await connectDB();
  console.log('Creating indexes...');

  // ─── Existing Collections (updated TTLs) ─────────────────────────────────

  // ig_profiles — TTL: 24 hours (was 1 hour)
  const profiles = getCollection('ig_profiles');
  await profiles.createIndex({ username: 1 }, { unique: true });
  await recreateTTLIndex('ig_profiles', 'cachedAt', TTL_SECONDS.PROFILES);
  console.log('  ig_profiles: 2 indexes (TTL: 24h)');

  // ig_posts — TTL: 6 hours (was 10 min)
  const posts = getCollection('ig_posts');
  await posts.createIndex({ postId: 1 }, { unique: true });
  await posts.createIndex({ username: 1, timestamp: -1 });
  await posts.createIndex({ engagementScore: -1, timestamp: -1 });
  await posts.createIndex({ caption: 'text' });
  await recreateTTLIndex('ig_posts', 'cachedAt', TTL_SECONDS.POSTS);
  console.log('  ig_posts: 5 indexes (TTL: 6h)');

  // ig_reels — TTL: 6 hours (was 10 min)
  const reels = getCollection('ig_reels');
  await reels.createIndex({ postId: 1 }, { unique: true });
  await reels.createIndex({ username: 1, playsCount: -1 });
  await reels.createIndex({ engagementScore: -1 });
  await recreateTTLIndex('ig_reels', 'cachedAt', TTL_SECONDS.REELS);
  console.log('  ig_reels: 4 indexes (TTL: 6h)');

  // ig_hashtag_posts — TTL: 12 hours (was 10 min)
  const hashtagPosts = getCollection('ig_hashtag_posts');
  await hashtagPosts.createIndex({ postId: 1, sourceHashtag: 1 }, { unique: true });
  await hashtagPosts.createIndex({ sourceHashtag: 1, engagementScore: -1 });
  await hashtagPosts.createIndex({ sourceHashtag: 1, timestamp: -1 });
  await hashtagPosts.createIndex({ sourceHashtag: 1, username: 1 });
  await hashtagPosts.createIndex({ caption: 'text' });
  await recreateTTLIndex('ig_hashtag_posts', 'cachedAt', TTL_SECONDS.HASHTAG_POSTS);
  console.log('  ig_hashtag_posts: 6 indexes (TTL: 12h)');

  // ig_hashtag_stats — TTL: 12 hours (was 10 min)
  const hashtagStats = getCollection('ig_hashtag_stats');
  await hashtagStats.createIndex({ hashtag: 1 }, { unique: true });
  await recreateTTLIndex('ig_hashtag_stats', 'cachedAt', TTL_SECONDS.HASHTAG_STATS);
  console.log('  ig_hashtag_stats: 2 indexes (TTL: 12h)');

  // ig_hashtag_posts_meta — TTL: 12 hours (was 10 min)
  const hashtagMeta = getCollection('ig_hashtag_posts_meta');
  await hashtagMeta.createIndex({ hashtag: 1 }, { unique: true });
  await recreateTTLIndex('ig_hashtag_posts_meta', 'cachedAt', TTL_SECONDS.HASHTAG_META);
  console.log('  ig_hashtag_posts_meta: 2 indexes (TTL: 12h)');

  // ─── New Collections ─────────────────────────────────────────────────────

  // campaigns — NO TTL (durable)
  const campaigns = getCollection('campaigns');
  await campaigns.createIndex({ campaignId: 1 }, { unique: true });
  await campaigns.createIndex({ status: 1 });
  await campaigns.createIndex({ createdAt: -1 });
  console.log('  campaigns: 3 indexes (no TTL)');

  // campaign_posts — NO TTL (durable)
  const campaignPosts = getCollection('campaign_posts');
  await campaignPosts.createIndex({ campaignId: 1, postUrl: 1 }, { unique: true });
  await campaignPosts.createIndex({ campaignId: 1, complianceStatus: 1 });
  await campaignPosts.createIndex({ username: 1, campaignId: 1 });
  await campaignPosts.createIndex({ postId: 1 });
  await campaignPosts.createIndex({ lastCheckedAt: 1 });
  console.log('  campaign_posts: 5 indexes (no TTL)');

  // post_snapshots — TTL: 180 days
  const postSnapshots = getCollection('post_snapshots');
  await postSnapshots.createIndex({ postId: 1, capturedAt: -1 });
  await postSnapshots.createIndex({ postUrl: 1, capturedAt: -1 });
  await recreateTTLIndex('post_snapshots', 'capturedAt', TTL_SECONDS.POST_SNAPSHOTS);
  console.log('  post_snapshots: 3 indexes (TTL: 180d)');

  // influencer_records — NO TTL (durable)
  const influencerRecords = getCollection('influencer_records');
  await influencerRecords.createIndex({ username: 1 }, { unique: true });
  await influencerRecords.createIndex({ lifecycleStatus: 1 });
  await influencerRecords.createIndex({ lastCollaborationDate: -1 });
  await influencerRecords.createIndex({ tags: 1 });
  console.log('  influencer_records: 4 indexes (no TTL)');

  await closeDB();
  console.log('All indexes created successfully.');
}

createIndexes().catch((err) => {
  console.error('Failed to create indexes:', err);
  process.exit(1);
});
