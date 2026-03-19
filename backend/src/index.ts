import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/auth";
import usersRoutes from "./routes/users";
import dashboardRoutes from "./routes/dashboard";
import teamsRoutes from "./routes/teams";
import rolesRoutes from "./routes/roles";
import settingsRoutes from "./routes/settings";
import tasksRoutes from "./routes/task";
import userLogsRoutes from "./routes/user-logs";
import brdRouter from "./routes/brd";
import uploadRoute from "./routes/brd/upload";
import notificationsRoutes from "./routes/notifications";
import { governanceControlsMiddleware } from "./middleware/governanceControls";
import {
  generalLimiter,
  uploadLimiter,
  processingLimiter,
  mutationLimiter,
} from "./middleware/rateLimits";


dotenv.config();

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable must be set before starting the server");
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables must be set");
}

const app = express();
const PORT = process.env.PORT || 4000;

// Trust first proxy so rate-limit and IP detection work correctly behind reverse proxies.
app.set("trust proxy", 1);

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  }),
);

// ── Body parsers (MUST be before routes) ──────────────────────────────────────
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// ── Trust proxy — required for req.ip to work behind any reverse proxy ────────
// Without this, express-rate-limit throws ERR_ERL_UNDEFINED_IP_ADDRESS.
app.set("trust proxy", 1);

// ── Governance controls (maintenance mode + strict rate limit mode) ──────────
app.use(governanceControlsMiddleware);

// ── Global rate limiter ────────────────────────────────────────────────────────
app.use(generalLimiter);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/auth",           authRoutes);
app.use("/users",          usersRoutes);
app.use("/dashboard",      dashboardRoutes);
app.use("/teams",          teamsRoutes);
app.use("/roles",          rolesRoutes);
app.use("/settings",       settingsRoutes);
app.use("/tasks",          tasksRoutes);
app.use("/user-logs",      userLogsRoutes);
app.use("/brd",            brdRouter);  // handles /brd/upload, /brd/:id/scope, etc.
app.use("/notifications",  notificationsRoutes);


// Health Check
app.get("/health", (_req, res) => {
  res.json({
    status: "Server is running",
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});