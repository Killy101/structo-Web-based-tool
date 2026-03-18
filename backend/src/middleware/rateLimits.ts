import rateLimit, { ipKeyGenerator } from "express-rate-limit";

// Helper fallback wrapper for keyGenerator
const safeIpKeyGenerator = (req: any) => ipKeyGenerator(req) || "unknown-ip";

// Login limiter
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." },
});

// Upload limiter
export const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => req.user?.userId?.toString() ?? safeIpKeyGenerator(req),
  message: { error: "Upload limit reached. Please wait before uploading more files." },
});

// Processing limiter
export const processingLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => req.user?.userId?.toString() ?? safeIpKeyGenerator(req),
  message: { error: "Processing limit reached. Please wait before making more requests." },
});

// General API limiter
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: safeIpKeyGenerator, // fallback included
  message: { error: "Too many requests. Please slow down." },
});

// Mutation limiter
export const mutationLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => req.user?.userId?.toString() ?? safeIpKeyGenerator(req),
  message: { error: "Too many modification requests. Please wait." },
});