/**
 * Unit tests for rate limit middleware configuration.
 * These tests verify the middleware is properly configured
 * without requiring a live database connection.
 */

import {
  loginLimiter,
  uploadLimiter,
  processingLimiter,
  generalLimiter,
  mutationLimiter,
} from "../middleware/rateLimits";

describe("Rate Limit Middleware", () => {
  it("should export loginLimiter as a function", () => {
    expect(typeof loginLimiter).toBe("function");
  });

  it("should export uploadLimiter as a function", () => {
    expect(typeof uploadLimiter).toBe("function");
  });

  it("should export processingLimiter as a function", () => {
    expect(typeof processingLimiter).toBe("function");
  });

  it("should export generalLimiter as a function", () => {
    expect(typeof generalLimiter).toBe("function");
  });

  it("should export mutationLimiter as a function", () => {
    expect(typeof mutationLimiter).toBe("function");
  });
});
