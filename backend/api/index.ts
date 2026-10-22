import type { VercelRequest, VercelResponse } from '@vercel/node';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';

let isConnected = false;
let app: any = null;

async function connectDB() {
  if (isConnected) return;
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGO_URI missing');
  await mongoose.connect(uri);
  isConnected = true;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  await connectDB();
  if (!app) {
    app = createApp();
  }
  return app(req, res);
}
