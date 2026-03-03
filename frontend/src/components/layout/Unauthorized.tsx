"use client";
import React from "react";
import { useTheme } from "../../context/ThemContext";

export default function Unauthorized() {
  const { dark } = useTheme();

  return (
    <div className="flex flex-col items-center justify-center h-full w-full select-none">
      {/* Illustration */}
      <svg
        width="280"
        height="220"
        viewBox="0 0 280 220"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="mb-8"
      >
        {/* Floor shadow */}
        <ellipse cx="140" cy="200" rx="100" ry="12" fill={dark ? "#1e293b" : "#e2e8f0"} />

        {/* Shield body */}
        <path
          d="M140 30 L190 55 L190 120 C190 155 165 180 140 190 C115 180 90 155 90 120 L90 55 Z"
          fill={dark ? "#1e293b" : "#f1f5f9"}
          stroke={dark ? "#334155" : "#cbd5e1"}
          strokeWidth="3"
        />

        {/* Shield inner */}
        <path
          d="M140 45 L180 65 L180 118 C180 148 160 170 140 178 C120 170 100 148 100 118 L100 65 Z"
          fill={dark ? "#0f172a" : "#ffffff"}
          stroke={dark ? "#475569" : "#94a3b8"}
          strokeWidth="1.5"
        />

        {/* Lock body */}
        <rect
          x="122"
          y="100"
          width="36"
          height="30"
          rx="4"
          fill="#ef4444"
          opacity="0.9"
        />

        {/* Lock shackle */}
        <path
          d="M128 100 L128 88 C128 80 133 75 140 75 C147 75 152 80 152 88 L152 100"
          stroke="#ef4444"
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
          opacity="0.9"
        />

        {/* Lock keyhole */}
        <circle cx="140" cy="112" r="4" fill="white" />
        <rect x="138.5" y="114" width="3" height="6" rx="1.5" fill="white" />

        {/* X marks */}
        <g stroke={dark ? "#475569" : "#94a3b8"} strokeWidth="2.5" strokeLinecap="round" opacity="0.5">
          <line x1="50" y1="60" x2="58" y2="68" />
          <line x1="58" y1="60" x2="50" y2="68" />
        </g>
        <g stroke={dark ? "#475569" : "#94a3b8"} strokeWidth="2.5" strokeLinecap="round" opacity="0.5">
          <line x1="222" y1="50" x2="230" y2="58" />
          <line x1="230" y1="50" x2="222" y2="58" />
        </g>
        <g stroke={dark ? "#475569" : "#94a3b8"} strokeWidth="2" strokeLinecap="round" opacity="0.35">
          <line x1="210" y1="140" x2="216" y2="146" />
          <line x1="216" y1="140" x2="210" y2="146" />
        </g>

        {/* Dots decoration */}
        <circle cx="60" cy="140" r="3" fill={dark ? "#334155" : "#cbd5e1"} opacity="0.5" />
        <circle cx="230" cy="100" r="2.5" fill={dark ? "#334155" : "#cbd5e1"} opacity="0.5" />
        <circle cx="45" cy="100" r="2" fill={dark ? "#334155" : "#cbd5e1"} opacity="0.4" />
        <circle cx="240" cy="160" r="2" fill={dark ? "#334155" : "#cbd5e1"} opacity="0.4" />

        {/* 403 text */}
        <text
          x="140"
          y="165"
          textAnchor="middle"
          fontFamily="sans-serif"
          fontSize="14"
          fontWeight="700"
          fill={dark ? "#64748b" : "#94a3b8"}
          letterSpacing="3"
        >
          403
        </text>
      </svg>

      {/* Text content */}
      <div className="text-center space-y-3 max-w-md px-4">
        <h2
          className={`text-xl font-bold ${dark ? "text-white" : "text-slate-900"}`}
        >
          Access Restricted
        </h2>
        <p
          className={`text-sm leading-relaxed ${dark ? "text-slate-400" : "text-slate-500"}`}
        >
          Sorry, only <span className={`font-semibold ${dark ? "text-red-400" : "text-red-500"}`}>Admin</span> and{" "}
          <span className={`font-semibold ${dark ? "text-red-400" : "text-red-500"}`}>Super Admin</span> are allowed on this page.
        </p>
        <p
          className={`text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}
        >
          Please contact your administrator if you need access.
        </p>
      </div>
    </div>
  );
}
