import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { connectDB, getDB } from './services/mongo.js';
import { phase1Router } from './routes/phase1.js';
import { phase2Router } from './routes/phase2.js';
import { chatRouter } from './routes/chat.js';
import { campaignRouter } from './routes/campaigns.js';
import { influencerRouter } from './routes/influencers.js';
import { errorHandler } from './middleware/errorHandler.js';
import { sessionCount } from './services/session_store.js';
import { startScheduler } from './services/scheduler.js';

const app = express();
const PORT = process.env.PORT || 3000;

const rateLimitOpts = {
  windowMs: 60 * 1000,
  message: { error: 'Too many requests', code: 'RATE_LIMITED', retryable: true },
};

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['POST', 'GET'],
  allowedHeaders: ['Content-Type'],
}));

app.use(express.json());

// Tools: 30 req/min — Apify calls are expensive
app.use('/api/tools', rateLimit({ ...rateLimitOpts, max: 30 }));
// Chat: tighter limit — each chat turn may fan out to many tool calls
app.use('/api/chat', rateLimit({ ...rateLimitOpts, max: 10 }));

app.get('/api/health', async (_req, res) => {
  try {
    await getDB().command({ ping: 1 });
    res.json({ status: 'ok', timestamp: new Date().toISOString(), sessions: sessionCount(), db: 'connected' });
  } catch {
    res.status(503).json({ status: 'degraded', timestamp: new Date().toISOString(), db: 'disconnected' });
  }
});

// Campaigns: 20 req/min
app.use('/api/campaigns', rateLimit({ ...rateLimitOpts, max: 20 }));

app.use('/api/tools', phase1Router);
app.use('/api/tools', phase2Router);
app.use('/api', chatRouter);
app.use('/api/campaigns', campaignRouter);
app.use('/api/influencers', influencerRouter);

app.use(errorHandler);

async function start() {
  await connectDB();
  app.listen(PORT, () => {
    console.log('GNC Brand Intel API running on port ' + PORT);
    startScheduler();
  });
}

start().catch(console.error);
