import { getCollection } from './mongo.js';
import { monitorCampaignPost } from './campaign.js';
import { executeGetHashtagPosts } from './tools.js';
import type { CampaignPost } from '../schemas/types.js';

const GNC_HASHTAGS = ['gnclivewell', 'gncfitness', 'gncindia', 'gncprotein'];

let monitorInterval: ReturnType<typeof setInterval> | null = null;
let prefetchInterval: ReturnType<typeof setInterval> | null = null;

// Guards to prevent overlapping runs if a job takes longer than its interval
let monitorRunning = false;
let prefetchRunning = false;

// ─── Monitor Active Campaign Posts ───────────────────────────────────────────

function getCheckIntervalMs(registeredAt: Date): number {
  const ageHours = (Date.now() - new Date(registeredAt).getTime()) / 3_600_000;
  if (ageHours < 24) return 2 * 3_600_000;    // First day: every 2 hours
  if (ageHours < 72) return 4 * 3_600_000;    // Days 2-3: every 4 hours
  if (ageHours < 168) return 12 * 3_600_000;  // Week 1: every 12 hours
  return 24 * 3_600_000;                       // After week 1: daily
}

async function monitorActivePosts(): Promise<void> {
  if (monitorRunning) { console.log('Scheduler: monitorActivePosts already running, skipping'); return; }
  monitorRunning = true;
  try {
    const posts = await getCollection<CampaignPost>('campaign_posts')
      .find({ status: { $ne: 'deleted' } })
      .toArray();

    const now = Date.now();
    let monitored = 0;

    for (const post of posts) {
      const interval = getCheckIntervalMs(post.registeredAt);
      const timeSinceCheck = now - new Date(post.lastCheckedAt).getTime();

      if (timeSinceCheck < interval) continue;

      try {
        await monitorCampaignPost({
          campaignId: post.campaignId,
          postUrl: post.postUrl,
        });
        monitored++;
        // Rate limit: 2s between Apify calls
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        console.error(`Scheduler: failed to monitor ${post.postUrl}:`, err instanceof Error ? err.message : err);
      }
    }

    if (monitored > 0) {
      console.log(`Scheduler: monitored ${monitored}/${posts.length} campaign posts`);
    }
  } catch (err) {
    console.error('Scheduler: monitorActivePosts error:', err instanceof Error ? err.message : err);
  } finally {
    monitorRunning = false;
  }
}

// ─── Prefetch GNC Hashtags ───────────────────────────────────────────────────

async function prefetchGNCHashtags(): Promise<void> {
  if (prefetchRunning) { console.log('Scheduler: prefetchGNCHashtags already running, skipping'); return; }
  prefetchRunning = true;
  try {
    console.log('Scheduler: prefetching GNC hashtags...');
    for (const hashtag of GNC_HASHTAGS) {
      try {
        await executeGetHashtagPosts({ hashtag, resultsLimit: 50 });
        console.log(`Scheduler: prefetched #${hashtag}`);
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        console.error(`Scheduler: failed to prefetch #${hashtag}:`, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error('Scheduler: prefetchGNCHashtags error:', err instanceof Error ? err.message : err);
  } finally {
    prefetchRunning = false;
  }
}

// ─── Scheduler Control ───────────────────────────────────────────────────────

export function startScheduler(): void {
  console.log('Scheduler: starting background jobs');

  // Monitor campaign posts every hour
  monitorInterval = setInterval(monitorActivePosts, 60 * 60_000);
  monitorInterval.unref();

  // Prefetch GNC hashtags every 6 hours
  prefetchInterval = setInterval(prefetchGNCHashtags, 6 * 3_600_000);
  prefetchInterval.unref();

  // Initial prefetch after 10s startup delay
  setTimeout(() => {
    prefetchGNCHashtags().catch(console.error);
  }, 10_000).unref();
}

export function stopScheduler(): void {
  if (monitorInterval) { clearInterval(monitorInterval); monitorInterval = null; }
  if (prefetchInterval) { clearInterval(prefetchInterval); prefetchInterval = null; }
  console.log('Scheduler: stopped');
}
