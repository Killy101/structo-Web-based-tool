"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface Shortcut {
  keys: string[];
  description: string;
  category: string;
}

const SHORTCUTS: Shortcut[] = [
  // Navigation
  { keys: ["Alt", "1"], description: "Go to Dashboard", category: "Navigation" },
  { keys: ["Alt", "2"], description: "Go to BRD Sources", category: "Navigation" },
  { keys: ["Alt", "N"], description: "New BRD (on BRD page)", category: "Navigation" },
  { keys: ["Alt", "3"], description: "Go to Compare", category: "Navigation" },
  { keys: ["Alt", "H"], description: "Go to History", category: "Navigation" },
  { keys: ["Alt", "U"], description: "Go to User Management", category: "Navigation" },
  // BRD
  { keys: ["↑"], description: "Scroll up in BRD list", category: "BRD" },
  { keys: ["↓"], description: "Scroll down in BRD list", category: "BRD" },
  // Compare
  { keys: ["↑"], description: "Previous change / chunk", category: "Compare" },
  { keys: ["↓"], description: "Next change / chunk", category: "Compare" },
  { keys: ["←"], description: "Shrink left pane (side-by-side)", category: "Compare" },
  { keys: ["→"], description: "Expand left pane (side-by-side)", category: "Compare" },
  // UI
  { keys: ["?"], description: "Toggle this shortcuts panel", category: "Interface" },
  { keys: ["Esc"], description: "Close any open panel or modal", category: "Interface" },
  // BRD Workflow
  { keys: ["Ctrl", "→"], description: "Next step in BRD workflow", category: "BRD Workflow" },
  { keys: ["Ctrl", "←"], description: "Previous step in BRD workflow", category: "BRD Workflow" },
  { keys: ["Ctrl", "Enter"], description: "Confirm & advance to next step", category: "BRD Workflow" },
  { keys: ["Ctrl", "Shift", "A"], description: "Add a new row (Scope / TOC / Citations / Metadata)", category: "BRD Workflow" },
  { keys: ["Ctrl", "Shift", "D"], description: "Delete focused row (or last row if none focused)", category: "BRD Workflow" },
  { keys: ["Esc"], description: "Close / exit BRD workflow", category: "BRD Workflow" },
  { keys: ["?"], description: "Show BRD shortcuts panel (inside BRD)", category: "BRD Workflow" },
];

const CATEGORIES = Array.from(new Set(SHORTCUTS.map(s => s.category)));

function Key({ label }: { label: string }) {
  return (
    <kbd
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2px 7px",
        minWidth: 24,
        height: 22,
        borderRadius: 5,
        fontSize: 11,
        fontFamily: "'JetBrains Mono', monospace",
        fontWeight: 600,
        background: "rgba(26,143,209,0.08)",
        border: "1px solid rgba(26,143,209,0.2)",
        borderBottom: "2px solid rgba(26,143,209,0.3)",
        color: "#42b4f5",
        lineHeight: 1,
      }}
    >
      {label}
    </kbd>
  );
}

export default function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const handleKey = useCallback((e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    const inInput = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable;

    // ? opens/closes the panel (only when not in input)
    if (e.key === "?" && !e.ctrlKey && !e.metaKey && !inInput) {
      e.preventDefault();
      setOpen(v => !v);
      return;
    }

    // Escape closes
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }

    // Alt + number/letter navigation (only when not in input)
    if (e.altKey && !inInput) {
      switch (e.key) {
        case "1": e.preventDefault(); router.push("/dashboard"); break;
        case "2": e.preventDefault(); router.push("/dashboard/brd"); break;
        case "3": e.preventDefault(); router.push("/dashboard/compare"); break;
        case "h": case "H": e.preventDefault(); router.push("/dashboard/history"); break;
        case "u": case "U": e.preventDefault(); router.push("/dashboard/users"); break;
      }
    }
  }, [router]);

  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  useEffect(() => {
    const open = () => setOpen(true);
    window.addEventListener("structo:open-shortcuts", open);
    return () => window.removeEventListener("structo:open-shortcuts", open);
  }, []);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: "fixed", inset: 0, zIndex: 8900,
          background: "rgba(4,10,20,0.7)",
          backdropFilter: "blur(8px)",
          animation: "ksIn 0.2s ease",
        }}
        onClick={() => setOpen(false)}
      />

      {/* Panel */}
      <div
        style={{
          position: "fixed",
          top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 8910,
          width: "100%",
          maxWidth: 480,
          padding: "0 16px",
          animation: "ksSlide 0.25s cubic-bezier(0.16,1,0.3,1)",
        }}
        onClick={e => e.stopPropagation()}
      >
        <style>{`
          @keyframes ksIn { from{opacity:0} to{opacity:1} }
          @keyframes ksSlide { from{opacity:0;transform:translate(-50%,-48%)} to{opacity:1;transform:translate(-50%,-50%)} }
        `}</style>

        <div style={{
          background: "#0b1a2e",
          border: "1px solid rgba(26,143,209,0.2)",
          borderRadius: 20,
          overflow: "hidden",
          boxShadow: "0 40px 80px rgba(0,0,0,0.6)",
        }}>
          {/* Header */}
          <div style={{
            padding: "16px 20px 14px",
            borderBottom: "1px solid rgba(26,143,209,0.1)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 30, height: 30, borderRadius: 8,
                background: "rgba(26,143,209,0.1)",
                border: "1px solid rgba(26,143,209,0.2)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#42b4f5",
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <rect x="2" y="4" width="20" height="16" rx="2"/>
                  <path d="M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01M8 16h8"/>
                </svg>
              </div>
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", fontFamily: "'Syne', sans-serif" }}>
                  Keyboard Shortcuts
                </h3>
                <p style={{ fontSize: 11, color: "#475569" }}>Press ? to open / close</p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{
                background: "none", border: "none", color: "#475569",
                cursor: "pointer", padding: 4, borderRadius: 6,
                display: "flex", alignItems: "center",
                transition: "color 0.15s",
              }}
              onMouseEnter={e => (e.currentTarget.style.color = "#94a3b8")}
              onMouseLeave={e => (e.currentTarget.style.color = "#475569")}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>

          {/* Shortcuts list */}
          <div style={{ padding: "12px 20px 20px", maxHeight: "60vh", overflowY: "auto" }}>
            {CATEGORIES.map(cat => (
              <div key={cat} style={{ marginBottom: 16 }}>
                <p style={{
                  fontSize: 10, fontWeight: 700, color: "#d4862e",
                  textTransform: "uppercase", letterSpacing: "0.12em",
                  marginBottom: 8,
                }}>
                  {cat}
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {SHORTCUTS.filter(s => s.category === cat).map((s, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "7px 10px", borderRadius: 9,
                        transition: "background 0.12s",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = "rgba(26,143,209,0.06)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                    >
                      <span style={{ fontSize: 13, color: "#94a3b8" }}>{s.description}</span>
                      <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
                        {s.keys.map((k, ki) => (
                          <React.Fragment key={`${k}-${ki}`}>
                            <Key label={k} />
                            {ki < s.keys.length - 1 && (
                              <span style={{ fontSize: 10, color: "#334155", fontWeight: 700 }}>+</span>
                            )}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Footer hint */}
          <div style={{
            padding: "10px 20px",
            borderTop: "1px solid rgba(26,143,209,0.08)",
            textAlign: "center",
          }}>
            <span style={{ fontSize: 11, color: "#334155" }}>
              Navigation shortcuts work everywhere · Press <Key label="Esc" /> to dismiss
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
