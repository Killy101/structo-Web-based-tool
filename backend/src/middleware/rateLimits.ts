import rateLimit, { ipKeyGenerator } from "express-rate-limit";

/**
 * Strict limiter for login — already exists on auth route,
 * kept here as the single source of truth.
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." },
});

/**
 * File upload limiter — prevents upload flooding.
 * 20 uploads per user per 10 minutes.
 */
export const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
<<<<<<< Updated upstream
  keyGenerator: (req: any) => req.user?.userId?.toString() ?? ipKeyGenerator(req),
=======
 keyGenerator: (req: any) => req.user?.userId?.toString() ?? ipKeyGenerator(req),
>>>>>>> Stashed changes
  message: { error: "Upload limit reached. Please wait before uploading more files." },
});

/**
 * Processing / heavy endpoint limiter.
 * 30 requests per 5 minutes per user.
 */
export const processingLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
<<<<<<< Updated upstream
  keyGenerator: (req: any) => req.user?.userId?.toString() ?? ipKeyGenerator(req),
=======
 keyGenerator: (req: any) => req.user?.userId?.toString() ?? ipKeyGenerator(req),
>>>>>>> Stashed changes
  message: { error: "Processing limit reached. Please wait before making more requests." },
});

/**
 * General API limiter — applied globally.
 * 200 requests per minute per IP.
 */
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
});

/**
 * Mutation limiter for destructive actions (delete, deactivate, etc.).
 * 30 per 5 minutes per user.
 */
export const mutationLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
<<<<<<< Updated upstream
  keyGenerator: (req: any) => req.user?.userId?.toString() ?? ipKeyGenerator(req),
=======
 keyGenerator: (req: any) => req.user?.userId?.toString() ?? ipKeyGenerator(req),
>>>>>>> Stashed changes
  message: { error: "Too many modification requests. Please wait." },
});
