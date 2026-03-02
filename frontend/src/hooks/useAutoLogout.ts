"use client";

import { useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Auto-logout after specified minutes of inactivity.
 * Tracks mouse movement, clicks, key presses, scrolling, and touch.
 */
export function useAutoLogout(timeoutMinutes: number = 20) {
  const router = useRouter();
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const logout = useCallback(() => {
    localStorage.removeItem("token");
    router.push("/login");
  }, [router]);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(logout, timeoutMinutes * 60 * 1000);
  }, [logout, timeoutMinutes]);

  useEffect(() => {
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];

    // Start the timer
    resetTimer();

    // Reset on any user activity
    events.forEach((event) => window.addEventListener(event, resetTimer));

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      events.forEach((event) => window.removeEventListener(event, resetTimer));
    };
  }, [resetTimer]);
}