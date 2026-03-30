"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./Eye.module.css";

interface EyeTransitionProps {
  onComplete: () => void;
}

export default function EyeTransition({ onComplete }: EyeTransitionProps) {
  const [phase, setPhase] = useState<
    "idle" | "blinking" | "opening" | "iris-expand" | "done"
  >("idle");
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  function addTimeout(fn: () => void, ms: number) {
    const id = setTimeout(fn, ms);
    timeoutsRef.current.push(id);
  }

  // Sequence: idle → blink shut → iris expands to black → navigate
  useEffect(() => {
    addTimeout(() => setPhase("blinking"), 600);      // eye blinks closed
    addTimeout(() => setPhase("iris-expand"), 1100);  // pupil swells to fill screen
    addTimeout(() => {
      setPhase("done");
      onComplete();                                   // router.push("/login") fires
    }, 1900);

    const scheduledTimeouts = [...timeoutsRef.current];
    return () => scheduledTimeouts.forEach(clearTimeout);
  }, [onComplete]);

  if (phase === "done") return null;

  return (
    <div className={styles.overlay}>
      {/* Ambient background */}
      <div className={styles.ambientBg} />

      {/* Scanlines */}
      <div className={styles.scanlines} />

      {/* Brand name */}
    <div className={`${styles.brandMark} ${phase !== "idle" ? styles.brandMarkFade : ""}`}>
      <span><span className={styles.brandI}>I</span>DAF</span>
      <span className={styles.brandTagline}>InnoStream Document Architecture Framework</span>
    </div>

      {/* THE EYE */}
      <div className={`${styles.eyeWrapper} ${phase === "blinking" || phase === "iris-expand" ? styles.eyeBlinking : ""}`}>
        {/* Outer glow ring */}
        <div className={styles.glowRing} />
        <div className={styles.glowRing2} />

        {/* Eye whites / sclera */}
        <svg
          className={styles.eyeSvg}
          viewBox="0 0 400 200"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="none"
        >
          <defs>
            <radialGradient id="scleraGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#0d2240" />
              <stop offset="100%" stopColor="#060d1a" />
            </radialGradient>
            <radialGradient id="irisGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#42b4f5" />
              <stop offset="35%" stopColor="#1a8fd1" />
              <stop offset="70%" stopColor="#146da3" />
              <stop offset="100%" stopColor="#060d1a" />
            </radialGradient>
            <radialGradient id="pupilGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#000" />
              <stop offset="85%" stopColor="#020810" />
              <stop offset="100%" stopColor="#0a1628" />
            </radialGradient>
            <filter id="irisGlow">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
            <clipPath id="eyeClip">
              <path d="M0,100 Q100,-20 200,100 Q300,220 400,100 Q300,-20 200,100 Q100,220 0,100 Z" />
            </clipPath>
          </defs>

          {/* Eye white */}
          <ellipse cx="200" cy="100" rx="200" ry="100" fill="url(#scleraGrad)" />

          {/* Iris */}
          <circle
            className={styles.iris}
            cx="200"
            cy="100"
            r="68"
            fill="url(#irisGrad)"
            filter="url(#irisGlow)"
          />

          {/* Iris texture rings */}
          <circle cx="200" cy="100" r="60" fill="none" stroke="rgba(66,180,245,0.15)" strokeWidth="1" />
          <circle cx="200" cy="100" r="50" fill="none" stroke="rgba(66,180,245,0.1)" strokeWidth="1" />
          <circle cx="200" cy="100" r="40" fill="none" stroke="rgba(26,143,209,0.12)" strokeWidth="0.5" />

          {/* Iris fibers - radial lines */}
          {Array.from({ length: 24 }).map((_, i) => {
            const angle = (i / 24) * Math.PI * 2;
            const x1 = 200 + Math.cos(angle) * 40;
            const y1 = 100 + Math.sin(angle) * 40;
            const x2 = 200 + Math.cos(angle) * 65;
            const y2 = 100 + Math.sin(angle) * 65;
            return (
              <line
                key={i}
                x1={x1} y1={y1}
                x2={x2} y2={y2}
                stroke="rgba(66,180,245,0.12)"
                strokeWidth="0.8"
              />
            );
          })}

          {/* Pupil */}
          <circle className={styles.pupil} cx="200" cy="100" r="30" fill="url(#pupilGrad)" />

          {/* Pupil inner depth */}
          <circle cx="200" cy="100" r="20" fill="#000" opacity="0.8" />

          {/* IDAF logo mark inside pupil */}
          <text
            className={styles.pupilText}
            x="200" y="104"
            textAnchor="middle"
            fill="rgba(26,143,209,0.6)"
            fontSize="9"
            fontFamily="Syne, sans-serif"
            fontWeight="800"
            letterSpacing="1"
          >
            IDAF
          </text>

          {/* Catchlight / specular highlight */}
          <ellipse cx="228" cy="78" rx="10" ry="6" fill="rgba(255,255,255,0.18)" transform="rotate(-20,228,78)" />
          <ellipse cx="222" cy="82" rx="4" ry="2.5" fill="rgba(255,255,255,0.1)" transform="rotate(-20,222,82)" />

          {/* Limbal ring */}
          <circle cx="200" cy="100" r="68" fill="none" stroke="rgba(6,13,26,0.7)" strokeWidth="4" />

          {/* Eyelid top */}
          <path
            className={styles.lidTop}
            d="M0,100 Q100,-20 200,100 Q300,-20 400,100 L400,0 L0,0 Z"
            fill="#060d1a"
          />

          {/* Eyelid bottom */}
          <path
            className={styles.lidBottom}
            d="M0,100 Q100,220 200,100 Q300,220 400,100 L400,200 L0,200 Z"
            fill="#060d1a"
          />

          {/* Eyelash hints top */}
          <path
            className={styles.lashTop}
            d="M40,58 Q50,40 55,35 M80,38 Q85,18 88,13 M120,26 Q122,5 124,0 M160,20 Q160,0 161,-3 M200,18 Q200,-3 200,-6 M240,20 Q240,0 239,-3 M280,26 Q278,5 277,0 M320,38 Q315,18 312,13 M360,58 Q350,40 345,35"
            stroke="#0d1e36"
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
          />
        </svg>

        {/* Orange limbal accent */}
        <div className={styles.orangeArc} />
      </div>

      {/* Iris expand overlay — the pupil blows up to fill screen */}
      <div className={`${styles.irisExpand} ${phase === "iris-expand" ? styles.irisExpandActive : ""}`} />

      {/* Corner decorations */}
      <div className={styles.cornerTL} />
      <div className={styles.cornerTR} />
      <div className={styles.cornerBL} />
      <div className={styles.cornerBR} />
    </div>
  );
}