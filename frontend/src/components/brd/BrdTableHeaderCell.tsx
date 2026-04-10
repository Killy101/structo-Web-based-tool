"use client";

import React from "react";

interface Props extends React.ThHTMLAttributes<HTMLTableCellElement> {
  title: string;
  greenNote?: string | string[];
  checkpoint?: string | string[];
  blueNote?: string | string[];
}

function toLines(value?: string | string[]): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

export default function BrdTableHeaderCell({
  title,
  greenNote,
  checkpoint,
  blueNote,
  className = "",
  ...rest
}: Props) {
  const greenLines = toLines(greenNote);
  const checkpointLines = toLines(checkpoint);
  const blueLines = toLines(blueNote);

  return (
    <th
      {...rest}
      className={[
        "px-3 py-2 text-left align-top border-b border-r border-slate-200 dark:border-[#2a3147] last:border-r-0 bg-slate-50 dark:bg-[#1e2235] whitespace-normal",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="space-y-1 leading-snug">
        <div
          className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-800 dark:text-slate-100"
          style={{ fontFamily: "'DM Mono', monospace" }}
        >
          {title}
        </div>

        {greenLines.map((line) => (
          <div key={`g-${line}`} className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 normal-case tracking-normal">
            {line}
          </div>
        ))}

        {checkpointLines.map((line) => (
          <div
            key={`c-${line}`}
            className="text-[10px] font-semibold text-slate-800 dark:text-slate-200 uppercase tracking-[0.08em]"
            style={{ fontFamily: "'DM Mono', monospace" }}
          >
            {line}
          </div>
        ))}

        {blueLines.map((line) => (
          <div key={`b-${line}`} className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 normal-case tracking-normal">
            {line}
          </div>
        ))}
      </div>
    </th>
  );
}
