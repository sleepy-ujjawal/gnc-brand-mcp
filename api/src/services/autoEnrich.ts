/**
 * autoEnrich.ts
 *
 * Automatically adds newly discovered influencers to `influencer_records`
 * as `prospect` whenever any tool surfaces a profile for the first time.
 *
 * All writes are fire-and-forget — callers do NOT await these.
 * This service has NO imports from analytics.ts or campaign.ts to avoid
 * circular dependencies.
 */

import { getCollection } from './mongo.js';

// GNC's own handles — never enroll these as prospects
const GNC_HANDLES = new Set(['gnclivewell', 'guardiangnc', 'gncofficial', 'gncindia', 'gnc']);

// Only auto-enroll hashtag post authors from GNC-relevant hashtags
// (competitor hashtags are too noisy — we already scraped those separately)
const GNC_HASHTAGS = new Set(['gnclivewell', 'gncfitness', 'gncindia', 'gncprotein', 'gnc']);

// Minimum followers to enroll when follower count is known
const MIN_FOLLOWERS = 10_000;

// Minimum engagement score to enroll hashtag post authors (proxy for influence when followers unknown)
const MIN_HASHTAG_ENGAGEMENT = 50;

/**
 * Upsert a single influencer as `prospect`.
 * - If new: inserts full record with status = 'prospect'
 * - If existing: only adds new source tag + updates updatedAt
 * - Never downgrades an active/dormant/terminated record
 */
export async function autoEnrollProspect(
  username: string,
  source: string,
  opts: { followersCount?: number; tags?: string[]; note?: string } = {},
): Promise<void> {
  if (!username) return;
  const u = username.toLowerCase().replace(/^@/, '');
  if (!u || GNC_HANDLES.has(u)) return;

  // Skip if follower count is known and below threshold
  if (opts.followersCount !== undefined && opts.followersCount > 0 && opts.followersCount < MIN_FOLLOWERS) return;

  const coll = getCollection('influencer_records');
  const now = new Date();
  const tags = [`source:${source}`, ...(opts.tags ?? [])];

  await coll.updateOne(
    { username: u },
    {
      // Only set these fields when creating a NEW record
      $setOnInsert: {
        username: u,
        lifecycleStatus: 'prospect',
        collaborationHistory: [],
        totalCollaborations: 0,
        lastCollaborationDate: null,
        averagePerformanceScore: null,
        complianceViolations: 0,
        notes: opts.note ? [opts.note] : [],
        createdAt: now,
      },
      // Always: add new source tags, update timestamp
      $addToSet: { tags: { $each: tags } },
      $set: { updatedAt: now },
    },
    { upsert: true },
  );
}

/**
 * Batch-enroll a list of influencers as prospects.
 * Runs all upserts in parallel (fire-and-forget safe).
 */
export async function autoEnrollBatch(
  users: Array<{ username: string; followersCount?: number; tags?: string[] }>,
  source: string,
): Promise<void> {
  await Promise.allSettled(
    users.map(u =>
      autoEnrollProspect(u.username, source, {
        followersCount: u.followersCount,
        tags: u.tags,
      }),
    ),
  );
}

/**
 * Enroll post authors discovered via a hashtag fetch.
 * Only runs for GNC-related hashtags; filters by minimum engagement score.
 */
export async function autoEnrollFromHashtagPosts(
  posts: Array<{ username: string; engagementScore?: number }>,
  hashtag: string,
): Promise<void> {
  const tag = hashtag.toLowerCase();
  if (!GNC_HASHTAGS.has(tag)) return; // competitor/generic hashtags — skip

  const eligible = posts.filter(p => (p.engagementScore ?? 0) >= MIN_HASHTAG_ENGAGEMENT);
  if (!eligible.length) return;

  await Promise.allSettled(
    eligible.map(p =>
      autoEnrollProspect(p.username, `hashtag:${tag}`, {
        note: `Organic post under #${tag}`,
      }),
    ),
  );
}
