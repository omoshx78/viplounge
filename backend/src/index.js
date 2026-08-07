import express from 'express';
// MUST be imported before any route files — it patches Express's Router so that an error
// thrown or rejected inside an async route handler is automatically forwarded to the error
// middleware below, instead of becoming an unhandled promise rejection that crashes the whole
// Node process. Without this, a single bad request (e.g. hitting a table that doesn't exist
// yet) can take the entire backend down, not just fail that one request.
import 'express-async-errors';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();

import authRoutes from './routes/auth.js';
import checkinRoutes from './routes/checkin.js';
import staffRoutes from './routes/staff.js';
import visitsRoutes from './routes/visits.js';
import adminRoutes from './routes/admin.js';
import inventoryRoutes from './routes/inventory.js';

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : true,
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/checkin', checkinRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/visits', visitsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/inventory', inventoryRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`VIP lounge API listening on port ${port}`));

// Final safety net: log anything that slips past express-async-errors and the pool's own error
// handler rather than letting Node silently kill the whole process over one bad request.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});
