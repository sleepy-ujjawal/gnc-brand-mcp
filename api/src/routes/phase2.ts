import { Router, Request, Response, NextFunction } from 'express';
import { validate } from '../middleware/validate.js';
import { Schemas } from '../schemas/zod.js';
import { getTopPostsByReach, getBrandMentions, findTopInfluencers, checkUserTopicPosts, getMentionNetwork } from '../services/analytics.js';

export const phase2Router = Router();

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) {
  return (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };
}

phase2Router.post('/get_top_posts_by_reach',
  validate(Schemas.get_top_posts_by_reach),
  asyncHandler(async (req, res) => { res.json(await getTopPostsByReach(req.body)); })
);

phase2Router.post('/get_brand_mentions',
  validate(Schemas.get_brand_mentions),
  asyncHandler(async (req, res) => { res.json(await getBrandMentions(req.body)); })
);

phase2Router.post('/find_top_influencers',
  validate(Schemas.find_top_influencers),
  asyncHandler(async (req, res) => { res.json(await findTopInfluencers(req.body)); })
);

phase2Router.post('/check_user_topic_posts',
  validate(Schemas.check_user_topic_posts),
  asyncHandler(async (req, res) => { res.json(await checkUserTopicPosts(req.body)); })
);

phase2Router.post('/get_mention_network',
  validate(Schemas.get_mention_network),
  asyncHandler(async (req, res) => { res.json(await getMentionNetwork(req.body)); })
);
