// Single source of truth for all TTL durations (in milliseconds)
// Keeping original TTLs — no changes from the existing system

export const TTL = {
  PROFILES:       24 * 3_600_000,    // 24 hours
  POSTS:           6 * 3_600_000,    // 6 hours
  REELS:           6 * 3_600_000,    // 6 hours
  HASHTAG_POSTS:  12 * 3_600_000,    // 12 hours
  HASHTAG_STATS:  12 * 3_600_000,    // 12 hours
  HASHTAG_META:   12 * 3_600_000,    // 12 hours

  // New collections
  POST_SNAPSHOTS: 180 * 86_400_000,  // 180 days
} as const;

// TTL in seconds for MongoDB expireAfterSeconds index option
export const TTL_SECONDS = {
  PROFILES:       86400,      // 24 hours
  POSTS:          21600,      // 6 hours
  REELS:          21600,      // 6 hours
  HASHTAG_POSTS:  43200,      // 12 hours
  HASHTAG_STATS:  43200,      // 12 hours
  HASHTAG_META:   43200,      // 12 hours
  POST_SNAPSHOTS: 15552000,   // 180 days
} as const;
