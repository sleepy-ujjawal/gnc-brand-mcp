import { z } from 'zod';

const username = z.string().min(1).max(50).transform(u => u.replace(/^@/, '').toLowerCase());
const hashtag = z.string().min(1).transform(h => h.replace(/^#/, '').toLowerCase());
const limit10 = z.number().int().min(1).max(10).default(10);
const days = z.number().int().min(1).max(90);

export const Schemas = {
  get_profile: z.object({ username }),
  get_user_posts: z.object({ username, resultsLimit: z.number().int().min(1).max(50).default(20) }),
  get_user_reels: z.object({ username, resultsLimit: z.number().int().min(1).max(30).default(15) }),
  get_hashtag_posts: z.object({ hashtag, resultsLimit: z.number().int().min(1).max(100).default(50) }),
  get_hashtag_stats: z.object({ hashtag }),
  check_post: z.object({ postUrl: z.string().url() }),
  get_top_posts_by_reach: z.object({
    scope: z.enum(['hashtag', 'username']),
    scopeValue: z.string().min(1),
    timeframeDays: days.default(7),
    metric: z.enum(['engagement', 'likes', 'comments', 'views', 'plays']).default('engagement'),
    contentType: z.enum(['reel', 'post', 'all']).default('all'),
    limit: z.number().int().min(1).max(25).default(10),
  }),
  get_brand_mentions: z.object({
    brandKeywords: z.array(z.string().min(1)).min(1).max(10),
    hashtags: z.array(hashtag).min(1).max(10),
    timeframeDays: days.default(7),
    includeHandleMentions: z.boolean().default(true),
  }),
  find_top_influencers: z.object({
    hashtags: z.array(hashtag).min(1).max(10),
    brandKeywords: z.array(z.string()).max(10).optional(),
    minFollowers: z.number().int().min(0).optional(),
    maxFollowers: z.number().int().min(0).optional(),
    minEngagementRate: z.number().min(0).max(1).optional(),
    timeframeDays: days.default(30),
    influencerTier: z.enum(['nano', 'micro', 'macro', 'mega', 'all']).default('all'),
    limit: limit10,
    indianOnly: z.boolean().default(false),
  }),
  discover_influencers: z.object({
    niche: z.string().min(1).max(100),
    country: z.string().default('india'),
    minFollowers: z.number().int().min(0).default(100000),
    limit: z.number().int().min(1).max(25).default(10),
  }),
  check_user_topic_posts: z.object({
    username,
    keywords: z.array(z.string().min(1)).min(1).max(20),
    timeframeDays: days.default(30),
    includeReels: z.boolean().default(true),
  }),
  expand_network: z.object({
    seeds: z.array(username).min(1).max(10),
    minFollowers: z.number().int().min(0).default(100000),
    country: z.string().default('india'),
    limit: z.number().int().min(1).max(25).default(15),
  }),
  get_mention_network: z.object({
    hashtags: z.array(hashtag).min(1).max(10),
    minMentions: z.number().int().min(1).default(2),
    minFollowers: z.number().int().min(0).optional(),
    limit: limit10,
    excludeHandles: z.array(z.string()).max(20).optional(),
  }),

  // ─── Campaign & Lifecycle Schemas ──────────────────────────────────

  // REST-only: campaign CRUD
  create_campaign: z.object({
    campaignId: z.string().min(1).max(100).transform(s => s.toLowerCase().replace(/\s+/g, '-')),
    name: z.string().min(1).max(200),
    status: z.enum(['draft', 'active', 'completed', 'paused']).default('draft'),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    requiredHashtags: z.array(hashtag).min(1).max(20),
    requiredMentions: z.array(z.string().min(1).transform(u => u.replace(/^@/, '').toLowerCase())).default([]),
    requiredTags: z.array(z.string().min(1).transform(u => u.replace(/^@/, '').toLowerCase())).default([]),
    brandKeywords: z.array(z.string().min(1)).default(['GNC', 'gnc', 'GNC LiveWell']),
    budget: z.number().min(0).optional(),
    notes: z.string().max(2000).optional(),
  }),
  update_campaign: z.object({
    name: z.string().min(1).max(200).optional(),
    status: z.enum(['draft', 'active', 'completed', 'paused']).optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    requiredHashtags: z.array(hashtag).min(1).max(20).optional(),
    requiredMentions: z.array(z.string().min(1).transform(u => u.replace(/^@/, '').toLowerCase())).optional(),
    requiredTags: z.array(z.string().min(1).transform(u => u.replace(/^@/, '').toLowerCase())).optional(),
    brandKeywords: z.array(z.string().min(1)).optional(),
    budget: z.number().min(0).optional(),
    notes: z.string().max(2000).optional(),
  }),

  // Gemini tools
  register_campaign_post: z.object({
    campaignId: z.string().min(1).transform(s => s.toLowerCase().replace(/\s+/g, '-')),
    postUrls: z.array(z.string().url()).min(1).max(20),
    usernameOverride: z.string().optional().transform(u => u?.replace(/^@/, '').toLowerCase()),
  }),
  get_campaign_performance_summary: z.object({
    campaignId: z.string().min(1).transform(s => s.toLowerCase().replace(/\s+/g, '-')),
  }),
  monitor_campaign_post: z.object({
    campaignId: z.string().min(1).transform(s => s.toLowerCase().replace(/\s+/g, '-')),
    postUrl: z.string().url(),
  }),
  get_campaign_compliance_report: z.object({
    campaignId: z.string().min(1).transform(s => s.toLowerCase().replace(/\s+/g, '-')),
  }),
  evaluate_collaboration_performance: z.object({
    campaignId: z.string().min(1).transform(s => s.toLowerCase().replace(/\s+/g, '-')),
    username,
  }),
  get_continuation_recommendation: z.object({
    username,
  }),
  get_engagement_timeline: z.object({
    postUrl: z.string().url(),
    limit: z.number().int().min(1).max(100).default(50),
  }),
  mine_competitor_hashtags: z.object({
    competitorHashtags: z.array(hashtag).min(1).max(10),
    limit: limit10,
  }),
};
