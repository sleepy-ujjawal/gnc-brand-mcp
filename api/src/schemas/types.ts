import { ObjectId } from 'mongodb';

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
