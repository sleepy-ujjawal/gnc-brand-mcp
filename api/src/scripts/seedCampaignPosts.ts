import { readFileSync } from 'fs';
import { join } from 'path';
import { connectDB, closeDB } from '../services/mongo.js';
import { registerCampaignPosts } from '../services/campaign.js';

const DRY_RUN = process.argv.includes('--dry-run');

interface PostEntry {
  username: string;
  postUrls: string[];
}

interface PostsData {
  campaignId: string;
  posts: PostEntry[];
}

async function seedCampaignPosts() {
  await connectDB();
  console.log(`Seeding campaign posts... ${DRY_RUN ? '(DRY RUN)' : ''}`);

  const dataPath = join(__dirname, 'seed-data', 'posts.json');
  const postsData = JSON.parse(readFileSync(dataPath, 'utf-8')) as PostsData[];

  for (const entry of postsData) {
    console.log(`\nCampaign: ${entry.campaignId} (${entry.posts.length} influencers)`);

    if (DRY_RUN) {
      for (const p of entry.posts) {
        console.log(`  [DRY RUN] @${p.username}: ${p.postUrls.length} post(s)`);
        p.postUrls.forEach(u => console.log(`    - ${u}`));
      }
      continue;
    }

    // Register per influencer so output is grouped by username
    for (const influencer of entry.posts) {
      try {
        const result = await registerCampaignPosts({
          campaignId: entry.campaignId,
          postUrls: influencer.postUrls,
          usernameOverride: influencer.username,
        });

        const icon = result.errors === 0 ? '✓' : '⚠';
        console.log(`  ${icon} @${influencer.username}: registered=${result.registered}, errors=${result.errors}`);

        for (const r of result.results) {
          if (r.status === 'error') console.error(`      ✗ ${r.postUrl} → ${r.error}`);
          else console.log(`      ✓ ${r.postUrl}`);
        }
      } catch (err) {
        console.error(`  ✗ @${influencer.username}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  await closeDB();
  console.log('\nDone.');
}

seedCampaignPosts().catch((err) => {
  console.error('Failed to seed campaign posts:', err);
  process.exit(1);
});
