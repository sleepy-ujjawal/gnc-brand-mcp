import { Router, type Request, type Response, type NextFunction } from 'express';
import { validate } from '../middleware/validate.js';
import { Schemas } from '../schemas/zod.js';
import {
  createCampaign, getCampaign, listCampaigns, updateCampaign,
  registerCampaignPosts,
} from '../services/campaign.js';

export const campaignRouter = Router();

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };
}

// POST /api/campaigns — create campaign
campaignRouter.post('/', validate(Schemas.create_campaign), asyncHandler(async (req, res) => {
  const campaign = await createCampaign(req.body);
  res.status(201).json(campaign);
}));

// GET /api/campaigns — list campaigns
campaignRouter.get('/', asyncHandler(async (req, res) => {
  const status = req.query.status as string | undefined;
  const campaigns = await listCampaigns(status ? { status } : undefined);
  res.json({ campaigns, total: campaigns.length });
}));

// GET /api/campaigns/:id — get single campaign
campaignRouter.get('/:id', asyncHandler(async (req, res) => {
  const campaign = await getCampaign(req.params.id as string);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found', code: 'NOT_FOUND' });
  res.json(campaign);
}));

// PATCH /api/campaigns/:id — update campaign
campaignRouter.patch('/:id', validate(Schemas.update_campaign), asyncHandler(async (req, res) => {
  const campaign = await updateCampaign(req.params.id as string, req.body);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found', code: 'NOT_FOUND' });
  res.json(campaign);
}));

// POST /api/campaigns/:id/posts — register paid posts
campaignRouter.post('/:id/posts', asyncHandler(async (req, res) => {
  const body = { ...req.body, campaignId: req.params.id as string };
  const result = await registerCampaignPosts(body);
  res.status(201).json(result);
}));
