const express = require('express');
const app = express();

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Quantum Trust API LIVE' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is working!' });
});

app.get('/api', (req, res) => {
  res.json({ status: 'ok' });
});

module.exports = app;
