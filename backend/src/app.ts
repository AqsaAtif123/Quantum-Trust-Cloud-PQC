import mongoose from 'mongoose';
import { createApp } from '../src/app.js';

let isConnected = false;

async function connectDB() {
  if (isConnected) return;
  try {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL;
    if (!uri) {
      console.log('MONGO_URI missing');
      return;
    }
    await mongoose.connect(uri);
    isConnected = true;
    console.log('MongoDB Connected');
  } catch (err) {
    console.log('MongoDB Error:', err.message);
  }
}

const app = createApp();

// Root check
app.get('/', async (req, res) => {
  await connectDB();
  res.json({ 
    status: 'ok', 
    message: 'Quantum Trust API LIVE', 
    mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' 
  });
});

export default async function handler(req, res) {
  await connectDB();
  return app(req, res);
}
