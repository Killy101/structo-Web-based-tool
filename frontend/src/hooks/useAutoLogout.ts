"use client";

import { useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { authApi, removeToken } from "../services/api";

const THROTTLE_MS = 250;
const WARNING_BEFORE_MS = 60_000; // warn 1 minute before logout

/**
 * Auto-logout after specified minutes of inactivity.
 * Tracks mouse movement, clicks, key presses, scrolling, and touch.
 *
 * @param timeoutMinutes  - inactivity threshold (default 20)
 * @param onWarning       - called WARNING_BEFORE_MS ms before logout
 * @param onReset         - called whenever the timer is reset by activity
 */
export function useAutoLogout(
  timeoutMinutes: number = 20,
  onWarning?: () => void,
  onReset?: () => void,
) {
  const router = useRouter();
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const warnTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastFiredRef = useRef<number>(0);

  const logout = useCallback(() => {
    void authApi.logout().catch(() => {
      // Best effort only: proceed with local logout even if request fails.
    });
    removeToken();
    router.push("/login");
  }, [router]);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current);

    onReset?.();

    const totalMs = timeoutMinutes * 60 * 1000;
    const warnAt = totalMs - WARNING_BEFORE_MS;

    if (warnAt > 0) {
      warnTimerRef.current = setTimeout(() => onWarning?.(), warnAt);
    }
    timerRef.current = setTimeout(logout, totalMs);
  }, [logout, timeoutMinutes, onWarning, onReset]);

  const throttledReset = useCallback(() => {
    const now = Date.now();
    if (now - lastFiredRef.current > THROTTLE_MS) {
      lastFiredRef.current = now;
      resetTimer();
    }
  }, [resetTimer]);

  useEffect(() => {
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];

    resetTimer();

    events.forEach((event) => window.addEventListener(event, throttledReset, { passive: true }));

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
      events.forEach((event) => window.removeEventListener(event, throttledReset));
    };
  }, [resetTimer, throttledReset]);
}
