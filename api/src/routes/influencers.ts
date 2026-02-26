import { Router, type Request, type Response, type NextFunction } from 'express';
import { getInfluencerLifecycle } from '../services/campaign.js';

export const influencerRouter = Router();

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };
}

// GET /api/influencers/:username/lifecycle — get influencer lifecycle record
influencerRouter.get('/:username/lifecycle', asyncHandler(async (req, res) => {
  const username = (req.params.username as string).toLowerCase().replace(/^@/, '');
  const record = await getInfluencerLifecycle(username);
  if (!record) return res.status(404).json({ error: `No influencer record found for: ${username}`, code: 'NOT_FOUND' });
  const { _id, ...data } = record;
  res.json(data);
}));
