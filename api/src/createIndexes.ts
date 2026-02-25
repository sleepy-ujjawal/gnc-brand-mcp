import 'dotenv/config';
import { connectDB, getDB, closeDB } from './services/mongo.js';

async function main() {
  await connectDB();
  const db = getDB();

  await db.collection('ig_profiles').createIndexes([
    { key: { username: 1 }, name: 'username_unique', unique: true },
    { key: { cachedAt: 1 }, name: 'ttl_1hr', expireAfterSeconds: 3600 },
  ]);

  await db.collection('ig_posts').createIndexes([
    { key: { postId: 1 }, name: 'postId_unique', unique: true },
    { key: { username: 1, timestamp: -1 }, name: 'user_time' },
    { key: { engagementScore: -1, timestamp: -1 }, name: 'score_time' },
    { key: { caption: 'text' }, name: 'caption_text', weights: { caption: 10 } },
    { key: { cachedAt: 1 }, name: 'ttl_10min', expireAfterSeconds: 600 },
  ]);

  await db.collection('ig_reels').createIndexes([
    { key: { postId: 1 }, name: 'postId_unique', unique: true },
    { key: { username: 1, playsCount: -1 }, name: 'user_plays' },
    { key: { engagementScore: -1 }, name: 'score' },
    { key: { cachedAt: 1 }, name: 'ttl_10min', expireAfterSeconds: 600 },
  ]);

  await db.collection('ig_hashtag_posts').createIndexes([
    { key: { postId: 1, sourceHashtag: 1 }, name: 'post_hashtag', unique: true },
    { key: { sourceHashtag: 1, engagementScore: -1 }, name: 'hashtag_score' },
    { key: { sourceHashtag: 1, timestamp: -1 }, name: 'hashtag_time' },
    { key: { sourceHashtag: 1, username: 1 }, name: 'hashtag_user' },
    { key: { caption: 'text' }, name: 'caption_text', weights: { caption: 10 } },
    { key: { cachedAt: 1 }, name: 'ttl_10min', expireAfterSeconds: 600 },
  ]);

  await db.collection('ig_hashtag_stats').createIndexes([
    { key: { hashtag: 1 }, name: 'hashtag_unique', unique: true },
    { key: { cachedAt: 1 }, name: 'ttl_10min', expireAfterSeconds: 600 },
  ]);

  await db.collection('ig_hashtag_posts_meta').createIndexes([
    { key: { hashtag: 1 }, name: 'hashtag_unique', unique: true },
    { key: { cachedAt: 1 }, name: 'ttl_10min', expireAfterSeconds: 600 },
  ]);

  console.log('All indexes created successfully');
  await closeDB();
}

main().catch(e => { console.error(e); process.exit(1); });
