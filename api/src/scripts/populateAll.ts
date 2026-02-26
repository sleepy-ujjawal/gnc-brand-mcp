import { execSync } from 'child_process';

const args = process.argv.slice(2).join(' ');

const scripts = [
  'build/scripts/seedCampaigns.js',
  'build/scripts/seedInfluencers.js',
  'build/scripts/seedCampaignPosts.js',
];

console.log('=== Running all seed scripts ===\n');

for (const script of scripts) {
  console.log(`--- Running: ${script} ${args} ---`);
  try {
    execSync(`node ${script} ${args}`, { stdio: 'inherit', cwd: process.cwd() });
  } catch (err) {
    console.error(`Script failed: ${script}`);
    process.exit(1);
  }
  console.log('');
}

console.log('=== All seed scripts completed ===');
