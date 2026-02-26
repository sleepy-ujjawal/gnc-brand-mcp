import { readFileSync } from 'fs';
import { join } from 'path';
import { connectDB, closeDB, getCollection } from '../services/mongo.js';
import { runActor } from '../services/apify.js';
import { ACTORS } from '../constants/actors.js';
import { transformPost } from '../services/transform.js';
import type { InfluencerRecord } from '../schemas/types.js';

const DRY_RUN = process.argv.includes('--dry-run');
const SOURCE = (() => {
  const idx = process.argv.indexOf('--source');
  return idx !== -1 ? process.argv[idx + 1] : 'both';
})();

const GNC_HANDLES = ['gnclivewell', 'guardiangnc'];

interface ManualInfluencer {
  username: string;
  tags?: string[];
  notes?: string[];
}

async function seedFromApify(): Promise<string[]> {
  console.log('Fetching posts from GNC handles via Apify...');
  const mentionedUsernames = new Set<string>();

  for (const handle of GNC_HANDLES) {
    try {
      const items = await runActor<Record<string, unknown>>({
        actorId: ACTORS.POSTS,
        input: { username: [handle], resultsLimit: 50 },
      });

      for (const item of items) {
        const post = transformPost(item);
        for (const mention of post.mentionedAccounts) {
          const clean = mention.toLowerCase().replace(/^@/, '');
          if (!GNC_HANDLES.includes(clean) && clean.length > 1) {
            mentionedUsernames.add(clean);
          }
        }
      }
      console.log(`  Fetched ${items.length} posts from @${handle}`);
    } catch (err) {
      console.error(`  Failed to fetch @${handle}:`, err instanceof Error ? err.message : err);
    }
  }

  return Array.from(mentionedUsernames);
}

function loadManualData(): ManualInfluencer[] {
  const dataPath = join(__dirname, 'seed-data', 'influencers.json');
  return JSON.parse(readFileSync(dataPath, 'utf-8'));
}

async function seedInfluencers() {
  await connectDB();
  console.log(`Seeding influencers (source: ${SOURCE})... ${DRY_RUN ? '(DRY RUN)' : ''}`);

  let usernames: string[] = [];
  let manualData: ManualInfluencer[] = [];

  if (SOURCE === 'apify' || SOURCE === 'both') {
    const apifyUsernames = await seedFromApify();
    usernames.push(...apifyUsernames);
  }

  if (SOURCE === 'manual' || SOURCE === 'both') {
    manualData = loadManualData();
    usernames.push(...manualData.map(i => i.username.toLowerCase()));
  }

  // Deduplicate
  usernames = [...new Set(usernames)];

  const coll = getCollection<InfluencerRecord>('influencer_records');
  const now = new Date();

  const manualMap = new Map(manualData.map(i => [i.username.toLowerCase(), i]));

  for (const username of usernames) {
    const manual = manualMap.get(username);

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would upsert influencer: ${username}`);
      continue;
    }

    await coll.updateOne(
      { username },
      {
        $setOnInsert: {
          username,
          lifecycleStatus: 'prospect' as const,
          collaborationHistory: [],
          totalCollaborations: 0,
          lastCollaborationDate: null,
          averagePerformanceScore: null,
          complianceViolations: 0,
          notes: manual?.notes ?? [],
          tags: manual?.tags ?? [],
          createdAt: now,
        },
        $set: { updatedAt: now },
      },
      { upsert: true },
    );
    console.log(`  Upserted influencer: ${username}`);
  }

  await closeDB();
  console.log(`Done. ${usernames.length} influencers processed.`);
}

seedInfluencers().catch((err) => {
  console.error('Failed to seed influencers:', err);
  process.exit(1);
});
