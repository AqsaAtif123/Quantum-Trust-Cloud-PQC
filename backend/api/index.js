import express from 'express';
import mongoose from 'mongoose';

const app = express();
app.use(express.json());

let isConnected = false;

async function connectDB() {
  if (isConnected) return;
  try {
    const uri = process.env.MONGO_URI;
    if (!uri) return;
    await mongoose.connect(uri);
    isConnected = true;
    console.log('MongoDB Connected');
  } catch (err) {
    console.log('MongoDB Error:', err.message);
  }
}

app.get('/', async (req, res) => {
  await connectDB();
  res.json({ status: 'ok', message: 'Quantum Trust API LIVE', mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

app.get('/api/health', async (req, res) => {
  await connectDB();
  const state = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  res.json({ status: 'ok', mongo: state, timestamp: new Date().toISOString() });
});

export default app;
