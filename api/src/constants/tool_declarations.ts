import { SchemaType, type FunctionDeclaration } from '@google/generative-ai';

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'get_profile',
    description: 'Get current Instagram profile for any account: follower count, bio, posting frequency, verified status.',
    parameters: {
      type: SchemaType.OBJECT,
      required: ['username'],
      properties: {
        username: { type: SchemaType.STRING, description: 'Instagram handle, no @ symbol' },
      },
    },
  },
  {
    name: 'get_user_posts',
    description: 'Fetch recent feed posts for an Instagram account.',
    parameters: {
      type: SchemaType.OBJECT,
      required: ['username'],
      properties: {
        username: { type: SchemaType.STRING, description: 'Instagram handle' },
        resultsLimit: { type: SchemaType.NUMBER, description: 'Max posts to fetch. Default 20, max 50.' },
      },
    },
  },
  {
    name: 'get_user_reels',
    description: 'Fetch recent Reels for an account with play counts.',
    parameters: {
      type: SchemaType.OBJECT,
      required: ['username'],
      properties: {
        username: { type: SchemaType.STRING, description: 'Instagram handle' },
        resultsLimit: { type: SchemaType.NUMBER, description: 'Default 15, max 30.' },
      },
    },
  },
  {
    name: 'get_hashtag_posts',
    description: 'Fetch recent posts from a hashtag. ALWAYS call before analytics tools. Call multiple hashtags in parallel.',
    parameters: {
      type: SchemaType.OBJECT,
      required: ['hashtag'],
      properties: {
        hashtag: { type: SchemaType.STRING, description: 'Hashtag without # prefix' },
        resultsLimit: { type: SchemaType.NUMBER, description: 'Default 50, max 100.' },
      },
    },
  },
  {
    name: 'get_hashtag_stats',
    description: 'Get aggregate statistics for a hashtag: total post count, average engagement, posting velocity, top creators.',
    parameters: {
      type: SchemaType.OBJECT,
      required: ['hashtag'],
      properties: {
        hashtag: { type: SchemaType.STRING, description: 'Hashtag without # prefix' },
      },
    },
  },
  {
    name: 'check_post',
    description: 'Verify a single Instagram post URL is live and get its current metrics.',
    parameters: {
      type: SchemaType.OBJECT,
      required: ['postUrl'],
      properties: {
        postUrl: { type: SchemaType.STRING, description: 'Full Instagram post or reel URL' },
      },
    },
  },
  {
    name: 'get_top_posts_by_reach',
    description: 'Rank cached posts/reels by engagement score. MUST call get_hashtag_posts first.',
    parameters: {
      type: SchemaType.OBJECT,
      required: ['scope', 'scopeValue', 'timeframeDays'],
      properties: {
        scope: { type: SchemaType.STRING, format: 'enum', description: 'Scope type: hashtag or user', enum: ['hashtag', 'user'] },
        scopeValue: { type: SchemaType.STRING, description: 'Hashtag name or username' },
        timeframeDays: { type: SchemaType.NUMBER, description: 'Number of days to look back' },
        metric: { type: SchemaType.STRING, format: 'enum', description: 'Sort metric', enum: ['engagement', 'likes', 'comments', 'views', 'plays'] },
        contentType: { type: SchemaType.STRING, format: 'enum', description: 'Filter by type', enum: ['reel', 'post', 'all'] },
        limit: { type: SchemaType.NUMBER, description: 'Max results (default 10)' },
      },
    },
  },
  {
    name: 'get_brand_mentions',
    description: 'Count and list posts mentioning brand keywords across cached hashtag posts.',
    parameters: {
      type: SchemaType.OBJECT,
      required: ['brandKeywords', 'hashtags', 'timeframeDays'],
      properties: {
        brandKeywords: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: 'Brand keywords to search' },
        hashtags: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: 'Hashtags to search within' },
        timeframeDays: { type: SchemaType.NUMBER, description: 'Days to look back' },
        includeHandleMentions: { type: SchemaType.BOOLEAN, description: 'Include @mention searches' },
      },
    },
  },
  {
    name: 'find_top_influencers',
    description: 'Rank Instagram creators by engagement, brand affinity, and consistency. MUST call get_hashtag_posts first.',
    parameters: {
      type: SchemaType.OBJECT,
      required: ['hashtags'],
      properties: {
        hashtags: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: 'Hashtags to search within' },
        brandKeywords: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: 'Brand keywords to filter by' },
        minFollowers: { type: SchemaType.NUMBER, description: 'Minimum follower count' },
        maxFollowers: { type: SchemaType.NUMBER, description: 'Maximum follower count' },
        minEngagementRate: { type: SchemaType.NUMBER, description: 'Minimum engagement rate (0-1)' },
        timeframeDays: { type: SchemaType.NUMBER, description: 'Days to look back (default 30)' },
        influencerTier: { type: SchemaType.STRING, format: 'enum', description: 'Filter by tier', enum: ['nano', 'micro', 'macro', 'mega', 'all'] },
        limit: { type: SchemaType.NUMBER, description: 'Max results (default 10)' },
        indianOnly: { type: SchemaType.BOOLEAN, description: 'Filter to Indian influencers only based on post location data' },
      },
    },
  },
  {
    name: 'discover_influencers',
    description: 'Discover influencers by searching Google (site:instagram.com) for a niche and country. Returns real profiles with actual follower counts. Best tool for finding high-follower Indian influencers. Use this INSTEAD of find_top_influencers when the user wants influencers by country/niche without specific hashtag data.',
    parameters: {
      type: SchemaType.OBJECT,
      required: ['niche'],
      properties: {
        niche: { type: SchemaType.STRING, description: 'Niche or topic to search for e.g. "fitness", "bodybuilding", "yoga", "nutrition"' },
        country: { type: SchemaType.STRING, description: 'Country to target. Default: india' },
        minFollowers: { type: SchemaType.NUMBER, description: 'Minimum follower count. Default 100000 (1 lakh). Use 1000000 for 10 lakh+.' },
        limit: { type: SchemaType.NUMBER, description: 'Max results to return. Default 10, max 25.' },
      },
    },
  },
  {
    name: 'check_user_topic_posts',
    description: 'Scan a creator posts for keyword matches. Use for influencer vetting.',
    parameters: {
      type: SchemaType.OBJECT,
      required: ['username', 'keywords'],
      properties: {
        username: { type: SchemaType.STRING, description: 'Instagram username to check' },
        keywords: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: 'Keywords/topics to search for' },
        timeframeDays: { type: SchemaType.NUMBER, description: 'Days to look back (default 90)' },
        includeReels: { type: SchemaType.BOOLEAN, description: 'Include reels in search (default true)' },
      },
    },
  },
  {
    name: 'expand_network',
    description: "Expand discovery using Instagram's own recommendation algorithm. Provide seed accounts (known influencers) and this tool fetches their relatedProfiles — accounts Instagram itself recommends alongside them. Best used after you already know a few influencers and want to find similar ones in the same niche.",
    parameters: {
      type: SchemaType.OBJECT,
      required: ['seeds'],
      properties: {
        seeds: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: 'Known Instagram handles to use as seeds (1-10 accounts, no @ prefix)' },
        minFollowers: { type: SchemaType.NUMBER, description: 'Minimum follower count to include. Default 100000.' },
        country: { type: SchemaType.STRING, description: 'Country filter applied to bio text. Default "india". Use "all" to skip country filter.' },
        limit: { type: SchemaType.NUMBER, description: 'Max results to return. Default 15, max 25.' },
      },
    },
  },
  {
    name: 'get_mention_network',
    description: 'Mine existing cached hashtag posts to find accounts most frequently tagged/mentioned by others — a zero-API-cost peer-endorsement signal. Accounts tagged most often in a niche are usually its most influential voices. MUST call get_hashtag_posts first to populate the cache.',
    parameters: {
      type: SchemaType.OBJECT,
      required: ['hashtags'],
      properties: {
        hashtags: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: 'Hashtags to mine for mentions (must already be cached via get_hashtag_posts)' },
        minMentions: { type: SchemaType.NUMBER, description: 'Minimum times an account must be mentioned to appear. Default 2.' },
        minFollowers: { type: SchemaType.NUMBER, description: 'Minimum follower count filter (optional — triggers Apify lookup on cache miss).' },
        limit: { type: SchemaType.NUMBER, description: 'Max results. Default 10.' },
        excludeHandles: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: 'Handles to exclude from results (e.g. brand own accounts).' },
      },
    },
  },
];
