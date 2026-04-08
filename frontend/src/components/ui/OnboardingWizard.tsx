"use client";
import { useState, useCallback } from "react";

interface OnboardingWizardProps {
  onDone: () => void;
}

const STEPS = [
  {
    badge: "Welcome",
    title: "Welcome to Structo",
    subtitle: "Your intelligent document platform",
    desc: "Structo is built for legal & regulatory teams who need to compare document versions, detect structural changes, and generate compliant XML outputs — fast and accurately.",
    icon: (
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
      </svg>
    ),
    color: "#1a8fd1",
    bullets: [
      "Upload PDF, Word, or XML documents",
      "AI-powered comparison engine",
      "INNOD.XML structured output",
    ],
  },
  {
    badge: "Core Features",
    title: "What you can do",
    subtitle: "Powerful tools at your fingertips",
    desc: "Structo offers a complete suite of document intelligence features. Here's what's available to you based on your role and team configuration.",
    icon: (
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
      </svg>
    ),
    color: "#d4862e",
    bullets: [
      "BRD Sources — manage document processing sources",
      "Compare — side-by-side document diff viewer",
      "History — full audit trail of all actions",
      "Logs — activity visibility for admins",
    ],
  },
  {
    badge: "Quick Start",
    title: "Get started in 3 steps",
    subtitle: "Your first document comparison",
    desc: "Run your first document comparison in minutes. Upload your source documents, let Structo process them, then review the structured diff output.",
    icon: (
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
    ),
    color: "#10b981",
    bullets: [
      "① Go to BRD Sources → upload your document pair",
      "② Open Compare",
      "③ Review diffs and export validated XML",
    ],
  },
  {
    badge: "Pro Tips",
    title: "Power-user shortcuts",
    subtitle: "Work faster with keyboard shortcuts",
    desc: "Structo has built-in keyboard shortcuts to help you navigate quickly. Press ? anywhere in the app to see the full shortcuts reference.",
    icon: (
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2"/><path d="M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01M8 16h8"/>
      </svg>
    ),
    color: "#a78bfa",
    bullets: [
      "Press ? to open keyboard shortcuts help",
      "Use Alt+1–3, H, and U to jump between key pages",
      "Click the Live Activity button for the audit feed",
    ],
  },
];

export default function OnboardingWizard({ onDone }: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [exiting, setExiting] = useState(false);

  const current = STEPS[step];

  const goNext = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep(s => s + 1);
    } else {
      setExiting(true);
      setTimeout(onDone, 350);
    }
  }, [step, onDone]);

  const goBack = useCallback(() => {
    if (step > 0) {
      setStep(s => s - 1);
    }
  }, [step]);

  const skipAll = useCallback(() => {
    setExiting(true);
    setTimeout(onDone, 350);
  }, [onDone]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        background: "rgba(4, 10, 20, 0.85)",
        backdropFilter: "blur(12px)",
        animation: exiting ? "owFadeOut 0.35s ease forwards" : "owFadeIn 0.4s ease both",
      }}
    >
      <style>{`
        @keyframes owFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes owFadeOut { from { opacity: 1; } to { opacity: 0; } }
        @keyframes owSlideUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes owSlideDown { from { opacity: 0; transform: translateY(-16px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      <div
        style={{
          background: "#0b1a2e",
          border: "1px solid rgba(26,143,209,0.2)",
          borderRadius: 24,
          width: "100%",
          maxWidth: 520,
          boxShadow: "0 40px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(26,143,209,0.08)",
          overflow: "hidden",
          animation: "owSlideUp 0.45s cubic-bezier(0.16,1,0.3,1) both",
        }}
      >
        {/* Progress bar */}
        <div style={{ height: 3, background: "rgba(26,143,209,0.1)" }}>
          <div
            style={{
              height: "100%",
              background: `linear-gradient(90deg, #1a8fd1, ${current.color})`,
              width: `${((step + 1) / STEPS.length) * 100}%`,
              transition: "width 0.4s cubic-bezier(0.16,1,0.3,1)",
              borderRadius: 3,
            }}
          />
        </div>

        {/* Step header */}
        <div style={{ padding: "28px 32px 0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
            <div style={{ display: "flex", gap: 6 }}>
              {STEPS.map((_, i) => (
                <div
                  key={i}
                  style={{
                    width: i === step ? 20 : 6,
                    height: 6,
                    borderRadius: 3,
                    background: i <= step ? "#1a8fd1" : "rgba(26,143,209,0.15)",
                    transition: "all 0.3s cubic-bezier(0.16,1,0.3,1)",
                  }}
                />
              ))}
            </div>
            <button
              onClick={skipAll}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 12,
                color: "#475569",
                fontWeight: 500,
                padding: "4px 8px",
                borderRadius: 6,
                transition: "color 0.15s",
              }}
              onMouseEnter={e => (e.currentTarget.style.color = "#94a3b8")}
              onMouseLeave={e => (e.currentTarget.style.color = "#475569")}
            >
              Skip
            </button>
          </div>

          {/* Icon */}
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: 20,
              background: `${current.color}14`,
              border: `1px solid ${current.color}28`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: current.color,
              marginBottom: 20,
              animation: `owSlideUp 0.4s cubic-bezier(0.16,1,0.3,1) ${step * 0.05}s both`,
            }}
          >
            {current.icon}
          </div>

          {/* Badge */}
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "3px 10px",
            borderRadius: 100,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            background: `${current.color}18`,
            color: current.color,
            border: `1px solid ${current.color}28`,
            marginBottom: 10,
          }}>
            {current.badge}
          </span>

          <h2 style={{
            fontFamily: "'Syne', sans-serif",
            fontSize: 24,
            fontWeight: 800,
            color: "#ffffff",
            letterSpacing: "-0.5px",
            lineHeight: 1.2,
            marginBottom: 6,
          }}>
            {current.title}
          </h2>
          <p style={{ fontSize: 12, color: current.color, fontWeight: 600, letterSpacing: "0.04em", marginBottom: 14 }}>
            {current.subtitle}
          </p>
          <p style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.7, marginBottom: 20 }}>
            {current.desc}
          </p>

          {/* Bullets */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 28 }}>
            {current.bullets.map((b, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  animation: `owSlideUp 0.35s cubic-bezier(0.16,1,0.3,1) ${0.1 + i * 0.06}s both`,
                }}
              >
                <div style={{
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  background: `${current.color}18`,
                  border: `1px solid ${current.color}30`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  marginTop: 1,
                }}>
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={current.color} strokeWidth="3" strokeLinecap="round">
                    <path d="M20 6L9 17l-5-5"/>
                  </svg>
                </div>
                <span style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.5 }}>{b}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "16px 32px 28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: "1px solid rgba(26,143,209,0.08)",
          }}
        >
          <button
            onClick={goBack}
            disabled={step === 0}
            style={{
              background: "none",
              border: "1px solid rgba(26,143,209,0.15)",
              borderRadius: 10,
              padding: "8px 18px",
              fontSize: 13,
              fontWeight: 600,
              color: step === 0 ? "#1e293b" : "#64748b",
              cursor: step === 0 ? "not-allowed" : "pointer",
              opacity: step === 0 ? 0.3 : 1,
              transition: "all 0.15s",
            }}
          >
            ← Back
          </button>

          <span style={{ fontSize: 12, color: "#475569" }}>
            {step + 1} of {STEPS.length}
          </span>

          <button
            onClick={goNext}
            style={{
              background: step === STEPS.length - 1
                ? `linear-gradient(135deg, #10b981, #059669)`
                : `linear-gradient(135deg, #1a8fd1, #146da3)`,
              border: "none",
              borderRadius: 10,
              padding: "8px 20px",
              fontSize: 13,
              fontWeight: 600,
              color: "#ffffff",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              boxShadow: step === STEPS.length - 1
                ? "0 4px 16px rgba(16,185,129,0.3)"
                : "0 4px 16px rgba(26,143,209,0.3)",
              transition: "all 0.2s",
            }}
          >
            {step === STEPS.length - 1 ? "Get Started" : "Next"}
            {step < STEPS.length - 1 && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            )}
            {step === STEPS.length - 1 && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M20 6L9 17l-5-5"/>
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
