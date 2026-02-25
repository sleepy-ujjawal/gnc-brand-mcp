import { IGPost, IGHashtagPost, IGProfile } from '../schemas/types.js';

export function engagementScore(
  likes: number,
  comments: number,
  views: number,
  plays: number
): number {
  return likes + comments + (views * 0.1) + (plays * 0.1);
}

const SPONSORED_MARKERS = [
  '#ad', '#sponsored', '#paid', '#partnership',
  '#collab', '#gifted', '#promo', '#ambassador',
  'paid partnership', 'sponsored by', 'in collaboration with',
];

export function detectSponsored(caption: string): boolean {
  const lower = caption.toLowerCase();
  return SPONSORED_MARKERS.some(marker => lower.includes(marker));
}

export function parseHashtags(caption: string): string[] {
  const matches = caption.match(/#[\w]+/g);
  return matches ? matches.map(h => h.toLowerCase()) : [];
}

export function parseMentions(caption: string): string[] {
  const matches = caption.match(/@[\w.]+/g);
  return matches ? matches.map(m => m.toLowerCase()) : [];
}

export function transformPost(raw: Record<string, any>, sourceHashtag?: string): IGPost | IGHashtagPost {
  const caption = raw.caption ?? raw.text ?? '';
  const likes = raw.likesCount ?? raw.likes ?? 0;
  const comments = raw.commentsCount ?? raw.comments ?? 0;
  const views = raw.videoViewCount ?? raw.viewsCount ?? raw.views ?? 0;
  const plays = raw.videoPlayCount ?? raw.playsCount ?? raw.plays ?? 0;

  const base: IGPost = {
    postId: raw.id ?? raw.shortCode ?? raw.url ?? '',
    username: (raw.ownerUsername ?? raw.username ?? '').toLowerCase(),
    type: raw.type ?? (plays > 0 ? 'reel' : 'post'),
    caption,
    hashtags: parseHashtags(caption),
    mentionedAccounts: parseMentions(caption),
    likesCount: likes,
    commentsCount: comments,
    viewsCount: views,
    playsCount: plays,
    engagementScore: engagementScore(likes, comments, views, plays),
    isSponsored: detectSponsored(caption),
    timestamp: raw.timestamp ? new Date(raw.timestamp) : new Date(),
    url: raw.url ?? raw.postUrl ?? '',
    cachedAt: new Date(),
  };

  if (sourceHashtag) {
    const locationName: string | undefined = raw.locationName ?? raw.location?.name ?? undefined;
    const locationId: string | undefined = raw.locationId ? String(raw.locationId) : undefined;
    return { ...base, sourceHashtag, ...(locationName && { locationName }), ...(locationId && { locationId }) } as IGHashtagPost;
  }

  return base;
}

export function transformProfile(raw: Record<string, any>): IGProfile {
  return {
    username: (raw.username ?? '').toLowerCase(),
    fullName: raw.fullName ?? raw.name ?? '',
    bio: raw.biography ?? raw.bio ?? '',
    followersCount: raw.followersCount ?? raw.followers ?? 0,
    followingCount: raw.followingCount ?? raw.following ?? 0,
    postsCount: raw.postsCount ?? raw.posts ?? 0,
    isVerified: raw.verified ?? raw.isVerified ?? false,
    profilePicUrl: raw.profilePicUrl ?? raw.profilePicUrlHD ?? '',
    externalUrl: raw.externalUrl ?? raw.website ?? '',
    cachedAt: new Date(),
  };
}
