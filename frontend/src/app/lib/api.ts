import axios from "axios";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
});

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("token");

    if (token) {
      if (!config.headers) {
        config.headers = {};
      }
      config.headers.Authorization = `Bearer ${token}`;
    }
  }

  return config;
});

// ── 429 response interceptor ──────────────────────────────
// Converts rate-limit responses into descriptive Error objects so
// callers can surface them in toasts / UI instead of silent failures.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 429) {
      const retryAfter = error.response.headers?.["retry-after"];
      const seconds = retryAfter ? Number(retryAfter) : null;
      const msg = seconds
        ? `Too many requests. Please wait ${seconds} second${seconds !== 1 ? "s" : ""} before trying again.`
        : "Too many requests. Please slow down and try again shortly.";
      return Promise.reject(new Error(msg));
    }
    if (error?.response?.status === 503) {
      const serverMsg = error.response.data?.error ?? "";
      const isMaintenance =
        serverMsg.toLowerCase().includes("maintenance") ||
        error.response.headers?.["x-maintenance-mode"] === "1";
      const msg = isMaintenance
        ? "The system is currently in maintenance mode. Write operations are temporarily unavailable. Please try again later."
        : "Service temporarily unavailable (503). Please try again in a moment.";
      return Promise.reject(new Error(msg));
    }
    return Promise.reject(error);
  },
);

export default api;
