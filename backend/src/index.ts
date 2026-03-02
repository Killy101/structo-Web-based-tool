import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes      from './routes/auth';
import usersRoutes     from './routes/users';
import dashboardRoutes from './routes/dashboard';
import brdRouter from "./routes/brd/index";

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 4000;

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/auth',      authRoutes);
app.use('/users',     usersRoutes);
app.use('/dashboard', dashboardRoutes);
app.use("/brd", brdRouter);

// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'Server is running', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});