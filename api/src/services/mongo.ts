import 'dotenv/config';
import { MongoClient, Db, Collection, Document } from 'mongodb';

let client: MongoClient | null = null;
let db: Db | null = null;

const DB_NAME = 'gnc_influencer';

export async function connectDB(): Promise<Db> {
  if (db) return db;

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set');

  client = new MongoClient(uri, {
    minPoolSize: 2,
    maxPoolSize: 10,
  });

  await client.connect();
  db = client.db(DB_NAME);
  console.log(`Connected to MongoDB: ${DB_NAME}`);
  return db;
}

export function getDB(): Db {
  if (!db) throw new Error('Database not connected. Call connectDB() first.');
  return db;
}

export function getCollection<T extends Document = Document>(name: string): Collection<T> {
  return getDB().collection<T>(name);
}

export async function closeDB(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log('MongoDB connection closed');
  }
}
