import { connectDB, closeDB, getCollection } from '../services/mongo.js';

async function createIndexes() {
  await connectDB();
  console.log('Creating indexes...');

  // ig_profiles
  const profiles = getCollection('ig_profiles');
  await profiles.createIndex({ username: 1 }, { unique: true });
  await profiles.createIndex({ cachedAt: 1 }, { expireAfterSeconds: 3600 });
  console.log('  ig_profiles: 2 indexes');

  // ig_posts
  const posts = getCollection('ig_posts');
  await posts.createIndex({ postId: 1 }, { unique: true });
  await posts.createIndex({ username: 1, timestamp: -1 });
  await posts.createIndex({ engagementScore: -1, timestamp: -1 });
  await posts.createIndex({ caption: 'text' });
  await posts.createIndex({ cachedAt: 1 }, { expireAfterSeconds: 600 });
  console.log('  ig_posts: 5 indexes');

  // ig_reels
  const reels = getCollection('ig_reels');
  await reels.createIndex({ postId: 1 }, { unique: true });
  await reels.createIndex({ username: 1, playsCount: -1 });
  await reels.createIndex({ engagementScore: -1 });
  await reels.createIndex({ cachedAt: 1 }, { expireAfterSeconds: 600 });
  console.log('  ig_reels: 4 indexes');

  // ig_hashtag_posts
  const hashtagPosts = getCollection('ig_hashtag_posts');
  await hashtagPosts.createIndex({ postId: 1, sourceHashtag: 1 }, { unique: true });
  await hashtagPosts.createIndex({ sourceHashtag: 1, engagementScore: -1 });
  await hashtagPosts.createIndex({ sourceHashtag: 1, timestamp: -1 });
  await hashtagPosts.createIndex({ sourceHashtag: 1, username: 1 });
  await hashtagPosts.createIndex({ caption: 'text' });
  await hashtagPosts.createIndex({ cachedAt: 1 }, { expireAfterSeconds: 600 });
  console.log('  ig_hashtag_posts: 6 indexes');

  // ig_hashtag_stats
  const hashtagStats = getCollection('ig_hashtag_stats');
  await hashtagStats.createIndex({ hashtag: 1 }, { unique: true });
  await hashtagStats.createIndex({ cachedAt: 1 }, { expireAfterSeconds: 600 });
  console.log('  ig_hashtag_stats: 2 indexes');

  // ig_hashtag_posts_meta
  const hashtagMeta = getCollection('ig_hashtag_posts_meta');
  await hashtagMeta.createIndex({ hashtag: 1 }, { unique: true });
  await hashtagMeta.createIndex({ cachedAt: 1 }, { expireAfterSeconds: 600 });
  console.log('  ig_hashtag_posts_meta: 2 indexes');

  await closeDB();
  console.log('All indexes created successfully.');
}

createIndexes().catch((err) => {
  console.error('Failed to create indexes:', err);
  process.exit(1);
});
