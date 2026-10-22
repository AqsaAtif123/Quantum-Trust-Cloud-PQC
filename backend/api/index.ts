import mongoose from 'mongoose';
import { createApp } from '../src/app.js';

// Global cache for serverless - prevents MaxListeners warning
let cachedApp: any = null;
let cachedDb: any = null;

async function getApp() {
  if (cachedApp) return cachedApp;
  
  // Connect DB only once
  if (!cachedDb) {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGO_URI missing');
    cachedDb = await mongoose.connect(uri);
  }
  
  cachedApp = createApp();
  
  // Add root route for health check so "/" doesn't give ROUTE_NOT_FOUND
  cachedApp.get('/', (req: any, res: any) => {
    res.json({ status: 'ok', service: 'quantum-trust-cloud-pqc-api' });
  });
  
  return cachedApp;
}

export default async function handler(req: any, res: any) {
  const app = await getApp();
  return app(req, res);
}
