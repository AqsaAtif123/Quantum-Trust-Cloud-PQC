import mongoose from 'mongoose';
import { createApp } from '../src/app.js';

let cachedApp: any = null;
let cachedDb: any = null;

async function getApp() {
  if (cachedApp) return cachedApp;
  if (!cachedDb) {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGO_URI missing');
    cachedDb = await mongoose.connect(uri);
  }
  cachedApp = createApp();
  return cachedApp;
}

export default async function handler(req: any, res: any) {
  // Root ke liye direct response, taake ROUTE_NOT_FOUND na aaye
  if (req.url === '/' || req.url === '') {
    return res.json({ status: 'ok', service: 'quantum-trust-cloud-pqc-api' });
  }
  const app = await getApp();
  return app(req, res);
}
