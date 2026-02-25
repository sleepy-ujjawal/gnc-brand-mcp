import { Router, Request, Response, NextFunction } from 'express';
import { validate } from '../middleware/validate.js';
import { Schemas } from '../schemas/zod.js';
import {
  executeGetProfile, executeGetUserPosts, executeGetUserReels,
  executeGetHashtagPosts, executeGetHashtagStats, executeCheckPost,
  executeDiscoverInfluencers, executeExpandNetwork, ToolError,
} from '../services/tools.js';

export const phase1Router = Router();

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) {
  return (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };
}

function handleToolError(err: unknown, res: Response): boolean {
  if (err instanceof ToolError) {
    const status = err.code === 'NOT_FOUND' ? 404 : 500;
    res.status(status).json({ error: err.message, code: err.code, retryable: false });
    return true;
  }
  return false;
}

// 1. get_profile
phase1Router.post('/get_profile', validate(Schemas.get_profile), asyncHandler(async (req, res) => {
  try { res.json(await executeGetProfile(req.body)); }
  catch (err) { if (!handleToolError(err, res)) throw err; }
}));

// 2. get_user_posts
phase1Router.post('/get_user_posts', validate(Schemas.get_user_posts), asyncHandler(async (req, res) => {
  try { res.json(await executeGetUserPosts(req.body)); }
  catch (err) { if (!handleToolError(err, res)) throw err; }
}));

// 3. get_user_reels
phase1Router.post('/get_user_reels', validate(Schemas.get_user_reels), asyncHandler(async (req, res) => {
  try { res.json(await executeGetUserReels(req.body)); }
  catch (err) { if (!handleToolError(err, res)) throw err; }
}));

// 4. get_hashtag_posts
phase1Router.post('/get_hashtag_posts', validate(Schemas.get_hashtag_posts), asyncHandler(async (req, res) => {
  try { res.json(await executeGetHashtagPosts(req.body)); }
  catch (err) { if (!handleToolError(err, res)) throw err; }
}));

// 5. get_hashtag_stats
phase1Router.post('/get_hashtag_stats', validate(Schemas.get_hashtag_stats), asyncHandler(async (req, res) => {
  try { res.json(await executeGetHashtagStats(req.body)); }
  catch (err) { if (!handleToolError(err, res)) throw err; }
}));

// 6. check_post
phase1Router.post('/check_post', validate(Schemas.check_post), asyncHandler(async (req, res) => {
  try { res.json(await executeCheckPost(req.body)); }
  catch (err) { if (!handleToolError(err, res)) throw err; }
}));

// 7. discover_influencers
phase1Router.post('/discover_influencers', validate(Schemas.discover_influencers), asyncHandler(async (req, res) => {
  try { res.json(await executeDiscoverInfluencers(req.body)); }
  catch (err) { if (!handleToolError(err, res)) throw err; }
}));

// 8. expand_network
phase1Router.post('/expand_network', validate(Schemas.expand_network), asyncHandler(async (req, res) => {
  try { res.json(await executeExpandNetwork(req.body)); }
  catch (err) { if (!handleToolError(err, res)) throw err; }
}));
