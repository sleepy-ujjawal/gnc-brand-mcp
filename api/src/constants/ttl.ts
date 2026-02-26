// Single source of truth for all TTL durations (in milliseconds)
// All cache collections retain data for 30 days

export const TTL = {
  PROFILES:       30 * 86_400_000,   // 30 days
  POSTS:          30 * 86_400_000,   // 30 days
  REELS:          30 * 86_400_000,   // 30 days
  HASHTAG_POSTS:  30 * 86_400_000,   // 30 days
  HASHTAG_STATS:  30 * 86_400_000,   // 30 days
  HASHTAG_META:   30 * 86_400_000,   // 30 days

  // New collections
  POST_SNAPSHOTS: 180 * 86_400_000,  // 180 days
} as const;

// TTL in seconds for MongoDB expireAfterSeconds index option
export const TTL_SECONDS = {
  PROFILES:       2_592_000,   // 30 days
  POSTS:          2_592_000,   // 30 days
  REELS:          2_592_000,   // 30 days
  HASHTAG_POSTS:  2_592_000,   // 30 days
  HASHTAG_STATS:  2_592_000,   // 30 days
  HASHTAG_META:   2_592_000,   // 30 days
  POST_SNAPSHOTS: 15_552_000,  // 180 days
} as const;
