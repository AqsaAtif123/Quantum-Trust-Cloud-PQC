import mongoose from 'mongoose';
import { createApp } from '../src/app.js';

let isConnected = false;
async function connectDB() {
  if (isConnected) return;
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) return;
  await mongoose.connect(uri);
  isConnected = true;
}

const app = createApp();
export default async (req, res) => {
  await connectDB();
  return app(req, res);
}
