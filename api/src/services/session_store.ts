import { randomUUID } from 'crypto';
import type { Content } from '@google/generative-ai';

const MAX_SESSIONS = 500;
const SESSION_TTL = 30 * 60 * 1000; // 30 minutes

interface Session {
  id: string;
  history: Content[];
  createdAt: number;
  updatedAt: number;
}

const sessions = new Map<string, Session>();

function evictExpired(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.updatedAt > SESSION_TTL) {
      sessions.delete(id);
    }
  }
}

function evictOldest(): void {
  let oldest: string | null = null;
  let oldestTime = Infinity;
  for (const [id, session] of sessions) {
    if (session.updatedAt < oldestTime) {
      oldestTime = session.updatedAt;
      oldest = id;
    }
  }
  if (oldest) sessions.delete(oldest);
}

export function createSession(): string {
  if (sessions.size >= MAX_SESSIONS) { evictExpired(); evictOldest(); }
  const id = randomUUID();
  sessions.set(id, { id, history: [], createdAt: Date.now(), updatedAt: Date.now() });
  return id;
}

export function getSession(id: string): Content[] | null {
  const session = sessions.get(id);
  if (!session) return null;
  if (Date.now() - session.updatedAt > SESSION_TTL) { sessions.delete(id); return null; }
  session.updatedAt = Date.now();
  return session.history;
}

export function setSession(id: string, history: Content[]): void {
  const session = sessions.get(id);
  if (session) {
    session.history = history;
    session.updatedAt = Date.now();
  } else {
    if (sessions.size >= MAX_SESSIONS) evictOldest();
    sessions.set(id, { id, history, createdAt: Date.now(), updatedAt: Date.now() });
  }
}

export function deleteSession(id: string): void {
  sessions.delete(id);
}

export function sessionCount(): number {
  return sessions.size;
}

// Background eviction — runs every 5 min so hot paths stay O(1)
setInterval(evictExpired, 5 * 60 * 1000).unref();
