import { ObjectId } from 'mongodb';

// ─── Campaign & Lifecycle Types ──────────────────────────────────────────────

export type ComplianceStatus = 'compliant' | 'non_compliant' | 'pending_review';
export type PostStatus = 'live' | 'deleted' | 'edited' | 'unknown';
export type LifecycleStatus = 'prospect' | 'active' | 'dormant' | 'terminated' | 'watchlist';

export interface PostSnapshot {
  caption: string;
  hashtags: string[];
  mentionedAccounts: string[];
  likesCount: number;
  commentsCount: number;
  viewsCount: number;
  playsCount: number;
  engagementScore: number;
  isLive: boolean;
  capturedAt: Date;
}

export interface Campaign {
  _id?: ObjectId;
  campaignId: string;
  name: string;
  status: 'draft' | 'active' | 'completed' | 'paused';
  startDate: Date;
  endDate: Date;
  requiredHashtags: string[];
  requiredMentions: string[];
  requiredTags: string[];
  brandKeywords: string[];
  budget?: number;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CampaignPost {
  _id?: ObjectId;
  campaignId: string;
  postUrl: string;
  postId: string;
  username: string;
  platform: 'instagram';
  postType: 'post' | 'reel' | 'story';
  status: PostStatus;
  complianceStatus: ComplianceStatus;
  complianceIssues: string[];
  initialSnapshot: PostSnapshot;
  latestSnapshot: PostSnapshot;
  registeredAt: Date;
  lastCheckedAt: Date;
}

export interface PostSnapshotRecord {
  _id?: ObjectId;
  postId: string;
  postUrl: string;
  capturedAt: Date;
  caption: string;
  hashtags: string[];
  mentionedAccounts: string[];
  likesCount: number;
  commentsCount: number;
  viewsCount: number;
  playsCount: number;
  engagementScore: number;
  isLive: boolean;
  captionChanged: boolean;
  hashtagsChanged: boolean;
  tagsChanged: boolean;
}

export interface CollaborationEntry {
  campaignId: string;
  role: string;
  fee?: number;
  startDate: Date;
  endDate?: Date;
  performance: number | null;
}

export interface InfluencerRecord {
  _id?: ObjectId;
  username: string;
  lifecycleStatus: LifecycleStatus;
  collaborationHistory: CollaborationEntry[];
  totalCollaborations: number;
  lastCollaborationDate: Date | null;
  averagePerformanceScore: number | null;
  complianceViolations: number;
  notes: string[];
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

// ─── Existing Types ──────────────────────────────────────────────────────────

export interface IGProfile {
  _id?: ObjectId;
  username: string;
  fullName: string;
  bio: string;
  followersCount: number;
  followingCount: number;
  postsCount: number;
  isVerified: boolean;
  profilePicUrl: string;
  externalUrl: string;
  cachedAt: Date;
}

export interface IGPost {
  _id?: ObjectId;
  postId: string;
  username: string;
  type: string;
  caption: string;
  hashtags: string[];
  mentionedAccounts: string[];
  likesCount: number;
  commentsCount: number;
  viewsCount: number;
  playsCount: number;
  engagementScore: number;
  isSponsored: boolean;
  timestamp: Date;
  url: string;
  cachedAt: Date;
}

export interface IGHashtagPost extends IGPost {
  sourceHashtag: string;
  locationName?: string;
  locationId?: string;
}

export interface IGHashtagStats {
  _id?: ObjectId;
  hashtag: string;
  totalPostCount: number;
  recentPostsPerDay: number;
  avgLikesPerPost: number;
  avgCommentsPerPost: number;
  avgEngagementScore: number;
  topCreators: string[];
  peakPostingHour: string;
  sampleSize: number;
  cachedAt: Date;
}
