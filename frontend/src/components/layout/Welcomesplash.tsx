"use client";
import { useEffect, useState } from "react";

interface WelcomeSplashProps {
  firstName: string;
  onDone: () => void;
}

export default function WelcomeSplash({ firstName, onDone }: WelcomeSplashProps) {
  const [phase, setPhase] = useState<"enter" | "hold" | "exit">("enter");

  useEffect(() => {
    // enter → hold after 900ms, exit after 2700ms, done after 3600ms
    const t1 = setTimeout(() => setPhase("hold"), 900);
    const t2 = setTimeout(() => setPhase("exit"), 2700);
    const t3 = setTimeout(() => onDone(), 3600);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onDone]);

  const greeting = "Welcome back,";
  const name = firstName || "there"; // fallback if user data not yet loaded

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        background: "linear-gradient(135deg, #060d1a 0%, #0b1a2e 50%, #0d2240 100%)",
        animation:
          phase === "enter"
            ? "splashEnter 0.75s cubic-bezier(0.22, 1, 0.36, 1) forwards"
            : phase === "exit"
            ? "splashExit 0.9s cubic-bezier(0.4, 0, 0.2, 1) forwards"
            : "none",
        overflow: "hidden",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@300;400&display=swap');

        @keyframes splashEnter {
          0%   { opacity: 0; transform: scale(1.02); filter: blur(3px); }
          60%  { opacity: 1; transform: scale(1.005); filter: blur(0); }
          100% { opacity: 1; transform: scale(1); filter: blur(0); }
        }
        @keyframes splashExit {
          0%   { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
          55%  { opacity: 0.72; transform: translateY(-8px) scale(0.995); filter: blur(0.4px); }
          100% { opacity: 0; transform: translateY(-22px) scale(0.985); filter: blur(1.4px); }
        }

        /* Grid texture */
        @keyframes gridPan {
          from { background-position: 0 0; }
          to   { background-position: 40px 40px; }
        }

        /* Scan line */
        @keyframes scan {
          0%   { top: -4px; opacity: 0.8; }
          50%  { opacity: 0.4; }
          100% { top: 100%; opacity: 0; }
        }

        /* Greeting fade+slide */
        @keyframes greetIn {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* Name letters stagger */
        @keyframes letterIn {
          from { opacity: 0; transform: translateY(24px) skewY(4deg); filter: blur(4px); }
          to   { opacity: 1; transform: translateY(0) skewY(0); filter: blur(0); }
        }

        /* Underline expand */
        @keyframes lineExpand {
          from { transform: scaleX(0); }
          to   { transform: scaleX(1); }
        }

        /* Pulse ring */
        @keyframes ringPulse {
          0%   { transform: scale(0.9); opacity: 0.45; }
          50%  { transform: scale(1.02); opacity: 0.18; }
          100% { transform: scale(0.9); opacity: 0.45; }
        }

        /* Corner bracket draw */
        @keyframes bracketIn {
          from { opacity: 0; transform: scale(0.8); }
          to   { opacity: 1; transform: scale(1); }
        }

        /* Dot blink */
        @keyframes dotBlink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.2; }
        }
      `}</style>

      {/* Animated grid background */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        backgroundImage: "linear-gradient(rgba(66,180,245,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(66,180,245,0.04) 1px, transparent 1px)",
        backgroundSize: "40px 40px",
        animation: "gridPan 4s linear infinite",
        maskImage: "radial-gradient(ellipse 70% 70% at 50% 50%, black 30%, transparent 100%)",
      }} />

      {/* Radial glow */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse 55% 50% at 50% 50%, rgba(26,86,240,0.18) 0%, rgba(66,180,245,0.06) 40%, transparent 70%)",
      }} />

      {/* Scan line */}
      <div style={{
        position: "absolute", left: 0, right: 0, height: "2px",
        background: "linear-gradient(90deg, transparent 0%, rgba(66,180,245,0.6) 30%, rgba(125,211,252,0.9) 50%, rgba(66,180,245,0.6) 70%, transparent 100%)",
        animation: "scan 2s ease-in 0.3s forwards",
        pointerEvents: "none",
        top: "-4px",
      }} />

      {/* Corner brackets */}
      {[
        { top: 32, left: 32, rotate: "0deg" },
        { top: 32, right: 32, rotate: "90deg" },
        { bottom: 32, left: 32, rotate: "270deg" },
        { bottom: 32, right: 32, rotate: "180deg" },
      ].map((pos, i) => (
        <svg
          key={i}
          width="28" height="28" viewBox="0 0 28 28" fill="none"
          style={{
            position: "absolute", ...pos as any,
            stroke: "rgba(66,180,245,0.35)",
            strokeWidth: 1.5,
            animation: `bracketIn 0.5s ease ${0.1 + i * 0.08}s both`,
          }}
        >
          <path d="M0 12 L0 0 L12 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ))}

      {/* Pulse rings behind content */}
      {[1.0, 1.4, 1.8].map((scale, i) => (
        <div key={i} style={{
          position: "absolute",
          width: 300, height: 300,
          borderRadius: "50%",
          border: "1px solid rgba(66,180,245,0.1)",
          transform: `scale(${scale})`,
          animation: `ringPulse ${2 + i * 0.4}s ease-in-out ${i * 0.3}s infinite`,
          pointerEvents: "none",
        }} />
      ))}

      {/* Main content */}
      <div style={{ textAlign: "center", position: "relative", zIndex: 1, padding: "0 24px" }}>

        {/* Eyebrow */}
        <p style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 11,
          fontWeight: 400,
          letterSpacing: "0.24em",
          textTransform: "uppercase",
          color: "rgba(66,180,245,0.7)",
          marginBottom: 20,
          animation: "greetIn 0.6s ease 0.4s both",
        }}>
          STRUCTO · Legal Regulatory Delivery Unit
        </p>

        {/* Greeting line */}
        <p style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 18,
          fontWeight: 300,
          color: "rgba(148,163,184,0.9)",
          marginBottom: 8,
          animation: "greetIn 0.6s ease 0.55s both",
          letterSpacing: "0.02em",
        }}>
          {greeting}
        </p>

        {/* Name — letter by letter */}
        <div style={{
          fontFamily: "'Syne', sans-serif",
          fontSize: "clamp(48px, 8vw, 80px)",
          fontWeight: 800,
          color: "#ffffff",
          letterSpacing: "-2px",
          lineHeight: 1,
          display: "flex",
          justifyContent: "center",
          gap: "0.02em",
          marginBottom: 24,
        }}>
          {name.split("").map((char, i) => (
            <span
              key={i}
              style={{
                display: "inline-block",
                animation: `letterIn 0.5s cubic-bezier(0.22,1,0.36,1) ${0.65 + i * 0.07}s both`,
                color: i === 0 ? "#42b4f5" : "#ffffff",
              }}
            >
              {char}
            </span>
          ))}
          {/* Blinking cursor */}
          <span style={{
            display: "inline-block",
            width: "3px",
            height: "0.85em",
            background: "#42b4f5",
            borderRadius: 2,
            marginLeft: 6,
            alignSelf: "center",
            animation: `letterIn 0.4s ease ${0.65 + name.length * 0.07}s both, dotBlink 0.9s ease ${0.65 + name.length * 0.07 + 0.4}s infinite`,
          }} />
        </div>

        {/* Animated underline */}
        <div style={{
          height: 2,
          background: "linear-gradient(90deg, transparent, #42b4f5, #7dd3fc, #42b4f5, transparent)",
          borderRadius: 2,
          transformOrigin: "center",
          animation: `lineExpand 0.7s cubic-bezier(0.22,1,0.36,1) ${0.7 + name.length * 0.07}s both`,
          marginBottom: 28,
          maxWidth: 400,
          margin: "0 auto 28px",
        }} />

        {/* Status line */}
        <p style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 12,
          fontWeight: 400,
          color: "rgba(100,116,139,0.8)",
          letterSpacing: "0.1em",
          animation: `greetIn 0.5s ease ${0.8 + name.length * 0.07}s both`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}>
          <span style={{
            display: "inline-block", width: 6, height: 6, borderRadius: "50%",
            background: "#10b981",
            boxShadow: "0 0 8px rgba(16,185,129,0.6)",
            animation: "dotBlink 1.5s ease infinite",
          }} />
          Preparing your workspace…
        </p>
      </div>
    </div>
  );
}