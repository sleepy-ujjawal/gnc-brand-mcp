import { readFileSync } from 'fs';
import { join } from 'path';
import { connectDB, closeDB, getCollection } from '../services/mongo.js';
import type { Campaign } from '../schemas/types.js';

const DRY_RUN = process.argv.includes('--dry-run');

async function seedCampaigns() {
  await connectDB();
  console.log(`Seeding campaigns... ${DRY_RUN ? '(DRY RUN)' : ''}`);

  const dataPath = join(__dirname, 'seed-data', 'campaigns.json');
  const campaigns = JSON.parse(readFileSync(dataPath, 'utf-8')) as Array<{
    campaignId: string; name: string; status: string;
    startDate: string; endDate: string;
    requiredHashtags: string[]; requiredMentions?: string[];
    requiredTags?: string[]; brandKeywords?: string[];
    budget?: number; notes?: string;
  }>;

  const coll = getCollection('campaigns');

  for (const data of campaigns) {
    const campaign = {
      campaignId: data.campaignId,
      name: data.name,
      status: data.status as Campaign['status'],
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      requiredHashtags: data.requiredHashtags,
      requiredMentions: data.requiredMentions ?? [],
      requiredTags: data.requiredTags ?? [],
      brandKeywords: data.brandKeywords ?? ['GNC', 'gnc', 'GNC LiveWell'],
      budget: data.budget,
      notes: data.notes,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would upsert campaign: ${campaign.campaignId} (${campaign.name})`);
    } else {
      await coll.updateOne(
        { campaignId: campaign.campaignId },
        { $set: campaign },
        { upsert: true },
      );
      console.log(`  Upserted campaign: ${campaign.campaignId}`);
    }
  }

  await closeDB();
  console.log('Done.');
}

seedCampaigns().catch((err) => {
  console.error('Failed to seed campaigns:', err);
  process.exit(1);
});
