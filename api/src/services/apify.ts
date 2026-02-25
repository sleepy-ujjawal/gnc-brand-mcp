import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });

export interface ActorRunConfig {
  actorId: string;
  input: Record<string, unknown>;
  timeoutSecs?: number;
  memoryMbytes?: number;
}

export async function runActor<T>(config: ActorRunConfig): Promise<T[]> {
  const run = await client.actor(config.actorId).call(config.input, {
    timeout: config.timeoutSecs ?? 60,
    memory: config.memoryMbytes ?? 256,
  });

  if (run.status !== 'SUCCEEDED') {
    throw new Error(`Apify actor ${config.actorId} failed: ${run.status}`);
  }

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return items as T[];
}
