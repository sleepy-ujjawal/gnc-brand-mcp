import { Request, Response, NextFunction } from 'express';
import { getCollection } from '../services/mongo.js';

export interface CacheConfig {
  collection: string;
  ttlMs: number;
  buildKey: (args: Record<string, unknown>) => string;
  buildQuery: (args: Record<string, unknown>) => Record<string, unknown>;
}

export function cacheFirst(config: CacheConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const args = req.body as Record<string, unknown>;
      const coll = getCollection(config.collection);
      const cutoff = new Date(Date.now() - config.ttlMs);

      const cached = await coll.findOne({
        ...config.buildQuery(args),
        cachedAt: { $gt: cutoff },
      });

      if (cached) {
        const { _id, ...doc } = cached;
        return res.json({ ...doc, cacheHit: true });
      }

      res.locals.cacheKey = config.buildKey(args);
      res.locals.cacheArgs = args;
      res.locals.collection = config.collection;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export async function writeCache(
  collection: string,
  query: Record<string, unknown>,
  data: Record<string, unknown>,
): Promise<void> {
  const coll = getCollection(collection);
  await coll.updateOne(query, { $set: { ...data, cachedAt: new Date() } }, { upsert: true });
}
