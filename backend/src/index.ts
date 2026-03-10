import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/auth";
import usersRoutes from "./routes/users";
import dashboardRoutes from "./routes/dashboard";
import teamsRoutes from "./routes/teams";
import rolesRoutes from "./routes/roles";
import tasksRoutes from "./routes/task";
import userLogsRoutes from "./routes/user-logs";
import brdRouter from "./routes/brd";
import uploadRoute from "./routes/brd/upload";


dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  }),
);
app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/auth",       authRoutes);
app.use("/users",      usersRoutes);
app.use("/dashboard",  dashboardRoutes);
app.use("/teams",      teamsRoutes);
app.use("/roles",      rolesRoutes);
app.use("/tasks",      tasksRoutes);
app.use("/user-logs",  userLogsRoutes);
app.use("/brd",        brdRouter);  // handles /brd/upload, /brd/:id/scope, etc.

// ── Health Check ──────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    status: "Server is running",
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
