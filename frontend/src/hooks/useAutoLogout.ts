"use client";

import { useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { authApi, removeToken } from "../services/api";

const WARNING_BEFORE_MS = 2 * 60 * 1000; // warn 2 minutes before logout

export function useAutoLogout(
  timeoutMinutes: number = 20,
  onWarning?: () => void,
  onReset?: () => void,
) {
  const router = useRouter();
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const warnTimerRef = useRef<NodeJS.Timeout | null>(null);

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

  useEffect(() => {
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];

    resetTimer();

    events.forEach((event) => window.addEventListener(event, resetTimer));

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
      events.forEach((event) => window.removeEventListener(event, resetTimer));
    };
  }, [resetTimer]);
}
