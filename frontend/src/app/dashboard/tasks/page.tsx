"use client";
import { useState } from "react";
import { Badge, Button, Card, CardHeader, SearchInput } from "@/components/ui";
import BrdFlow from "@/components/brd/BrdFlow";
import { useAuth } from "@/context/AuthContext";
import { useUsers } from "@/hooks";

// ── Types ─────────────────────────────────────────────────────────────────────
type BrdStatus = "Reviewed" | "Ready" | "Processing" | "Draft";

interface BrdSource {
  id: string;
  title: string;
  geography: string;
  status: BrdStatus;
  version: string;
  lastUpdated: string;
  editCount: number; // tracks how many edits → drives version bump
  comments: string[]; // plain-text comment queries
}

interface AssignedTask {
  id: string;
  taskName: string;
  assignedTo: string;
  assigneeId: number;
  dueDate: string;
  priority: "High" | "Medium" | "Low";
  brdSourceId: string; // links to a BRD source
}

// ── Mock data ─────────────────────────────────────────────────────────────────
const INITIAL_BRD_SOURCES: BrdSource[] = [
  {
    id: "BRD-001",
    title: "Fair Work Regulations 2009",
    geography: "Australia",
    status: "Reviewed",
    version: "v1.2",
    lastUpdated: "2025-03-15",
    editCount: 2,
    comments: [
      "Please verify clause 14b with legal team.",
      "Confirm effective date alignment.",
    ],
  },
  {
    id: "BRD-002",
    title: "Corporations Regulations 2001",
    geography: "Australia",
    status: "Ready",
    version: "v1.1",
    lastUpdated: "2025-03-20",
    editCount: 1,
    comments: ["Check section 6 cross-references."],
  },
  {
    id: "BRD-003",
    title: "Taxation Administration Regulations 2017",
    geography: "Australia",
    status: "Processing",
    version: "v1.0",
    lastUpdated: "2025-03-22",
    editCount: 0,
    comments: [],
  },
  {
    id: "BRD-004",
    title: "Financial Services Modernisation Act 2024",
    geography: "United Kingdom",
    status: "Draft",
    version: "v0.3",
    lastUpdated: "2025-03-25",
    editCount: 0,
    comments: ["Initial draft — pending stakeholder review."],
  },
];

const INITIAL_TASKS: AssignedTask[] = [];

const FILTER_CHIPS = [
  "All",
  "Processing",
  "Ready",
  "Reviewed",
  "Draft",
] as const;
type FilterKey = (typeof FILTER_CHIPS)[number];

// ── Helpers ───────────────────────────────────────────────────────────────────
const bumpVersion = (ver: string): string => {
  const match = ver.match(/^v(\d+)\.(\d+)$/);
  if (!match) return ver;
  const [, major, minor] = match;
  const newMinor = parseInt(minor) + 1;
  if (newMinor >= 10) return `v${parseInt(major) + 1}.0`;
  return `v${major}.${newMinor}`;
};

const today = () => new Date().toISOString().slice(0, 10);

const buildHistory = (src: BrdSource) => {
  const entries = [
    {
      ver: src.version,
      date: src.lastUpdated,
      note: "Current version",
      latest: true,
    },
  ];
  let ver = src.version;
  for (let i = 0; i < src.editCount && i < 3; i++) {
    const prev = ver.replace(
      /v(\d+)\.(\d+)/,
      (_, maj, min) => `v${maj}.${Math.max(0, parseInt(min) - 1)}`,
    );
    entries.push({
      ver: prev,
      date: "2025-02-14",
      note:
        i === src.editCount - 1
          ? "Initial draft published"
          : "Minor edits & corrections",
      latest: false,
    });
    ver = prev;
  }
  return entries;
};

// ── Status styles ─────────────────────────────────────────────────────────────
const STATUS_BADGE: Record<BrdStatus, string> = {
  Reviewed:
    "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  Ready:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  Processing: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  Draft: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400",
};

const PRIORITY_BADGE: Record<string, string> = {
  High: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  Medium:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  Low: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
};

const FILTER_CHIP_STYLES: Record<FilterKey, { base: string; active: string }> =
  {
    All: {
      base: "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-800",
      active:
        "bg-slate-700 dark:bg-slate-200 text-white dark:text-slate-900 border-slate-700 dark:border-slate-200",
    },
    Processing: {
      base: "border-sky-300 dark:border-sky-800 text-sky-700 dark:text-sky-400 bg-sky-50 dark:bg-sky-900/20",
      active: "bg-sky-500 text-white border-sky-500",
    },
    Ready: {
      base: "border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20",
      active: "bg-emerald-500 text-white border-emerald-500",
    },
    Reviewed: {
      base: "border-violet-300 dark:border-violet-800 text-violet-700 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20",
      active: "bg-violet-600 text-white border-violet-600",
    },
    Draft: {
      base: "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800",
      active: "bg-slate-500 text-white border-slate-500",
    },
  };

// ── Icons ─────────────────────────────────────────────────────────────────────
const EyeIcon = () => (
  <svg
    className="w-3.5 h-3.5"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
    />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
    />
  </svg>
);
const EditIcon = () => (
  <svg
    className="w-3.5 h-3.5"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
    />
  </svg>
);
const HistoryIcon = () => (
  <svg
    className="w-3.5 h-3.5"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);
const TrashIcon = () => (
  <svg
    className="w-3.5 h-3.5"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
    />
  </svg>
);
const PlusIcon = () => (
  <svg
    className="w-4 h-4"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2.5}
      d="M12 4v16m8-8H4"
    />
  </svg>
);
const CloseIcon = () => (
  <svg
    className="w-4 h-4"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M6 18L18 6M6 6l12 12"
    />
  </svg>
);
const TagIcon = () => (
  <svg
    className="w-3 h-3"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-5 5a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 10V5a2 2 0 012-2z"
    />
  </svg>
);
const CommentIcon = () => (
  <svg
    className="w-3.5 h-3.5"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-3 3v-3z"
    />
  </svg>
);
const UserIcon = () => (
  <svg
    className="w-4 h-4"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.75}
      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
    />
  </svg>
);
const CheckCircleIcon = () => (
  <svg
    className="w-4 h-4"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.75}
      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

// ── Edit Modal ────────────────────────────────────────────────────────────────
interface EditModalProps {
  src: BrdSource;
  onSave: (updated: BrdSource) => void;
  onClose: () => void;
}
function EditModal({ src, onSave, onClose }: EditModalProps) {
  const [title, setTitle] = useState(src.title);
  const [geography, setGeo] = useState(src.geography);
  const [status, setStatus] = useState<BrdStatus>(src.status);

  const handleSave = () => {
    const newEditCount = src.editCount + 1;
    const newVersion = bumpVersion(src.version);
    onSave({
      ...src,
      title,
      geography,
      status,
      version: newVersion,
      lastUpdated: today(),
      editCount: newEditCount,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md z-10">
        <Card className="shadow-2xl">
          <CardHeader
            title="Edit BRD Source"
            subtitle={src.id}
            action={
              <button
                onClick={onClose}
                className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <CloseIcon />
              </button>
            }
          />
          <div className="p-5 space-y-4">
            {/* Title */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Document Title
              </label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            {/* Geography */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Geography
              </label>
              <input
                value={geography}
                onChange={(e) => setGeo(e.target.value)}
                className="w-full text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            {/* Status */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as BrdStatus)}
                className="w-full text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {(
                  ["Draft", "Processing", "Ready", "Reviewed"] as BrdStatus[]
                ).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            {/* Version preview */}
            <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 rounded-xl">
              <HistoryIcon />
              <span className="text-xs text-amber-700 dark:text-amber-400">
                Saving will bump version:{" "}
                <span className="font-mono font-bold">{src.version}</span> →{" "}
                <span className="font-mono font-bold">
                  {bumpVersion(src.version)}
                </span>
              </span>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                variant="secondary"
                className="flex-1 justify-center"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button className="flex-1 justify-center" onClick={handleSave}>
                Save Changes
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── View Details Modal ────────────────────────────────────────────────────────
interface ViewModalProps {
  src: BrdSource;
  onClose: () => void;
  readOnly?: boolean; // production role only sees view
}
function ViewModal({ src, onClose, readOnly = false }: ViewModalProps) {
  const [comment, setComment] = useState("");
  const [comments, setComments] = useState<string[]>(src.comments);

  const addComment = () => {
    const trimmed = comment.trim();
    if (!trimmed) return;
    setComments((prev) => [...prev, trimmed]);
    setComment("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-lg z-10">
        <Card className="shadow-2xl">
          <CardHeader
            title="BRD Source Details"
            subtitle={src.id}
            action={
              <button
                onClick={onClose}
                className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <CloseIcon />
              </button>
            }
          />
          <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
            {/* Document info grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Document Title
                </span>
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  {src.title}
                </span>
              </div>
              <div>
                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Geography
                </span>
                <span className="text-xs text-slate-700 dark:text-slate-300">
                  {src.geography}
                </span>
              </div>
              <div>
                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Version
                </span>
                <span className="font-mono text-xs font-bold text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800/50 px-2 py-0.5 rounded-md">
                  {src.version}
                </span>
              </div>
              <div>
                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Status
                </span>
                <Badge
                  className={`inline-flex items-center gap-1.5 font-medium ${STATUS_BADGE[src.status]}`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      src.status === "Processing"
                        ? "bg-sky-500 animate-pulse"
                        : src.status === "Reviewed"
                          ? "bg-violet-600"
                          : src.status === "Ready"
                            ? "bg-emerald-600"
                            : "bg-slate-500"
                    }`}
                  />
                  {src.status}
                </Badge>
              </div>
              <div>
                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Last Updated
                </span>
                <span className="font-mono text-xs text-slate-600 dark:text-slate-400">
                  {src.lastUpdated}
                </span>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-slate-200 dark:border-slate-700" />

            {/* Comment Queries */}
            <div>
              <div className="flex items-center gap-2 mb-2.5">
                <CommentIcon />
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Comment Queries
                </span>
                {comments.length > 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/50">
                    {comments.length}
                  </span>
                )}
              </div>

              {comments.length === 0 ? (
                <p className="text-xs text-slate-400 dark:text-slate-500 italic">
                  No comments yet.
                </p>
              ) : (
                <div className="space-y-2 mb-3">
                  {comments.map((c, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 p-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl"
                    >
                      <div className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-[9px] font-bold text-indigo-700 dark:text-indigo-400">
                          {i + 1}
                        </span>
                      </div>
                      <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                        {c}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* Add comment — available to both roles */}
              <div className="flex gap-2">
                <input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addComment()}
                  placeholder="Add a comment query…"
                  className="flex-1 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  onClick={addComment}
                  className="px-3 py-2 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
                >
                  Add
                </button>
              </div>
            </div>

            <div className="pt-1">
              <Button
                variant="secondary"
                className="w-full justify-center"
                onClick={onClose}
              >
                Close
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── History Modal ─────────────────────────────────────────────────────────────
interface HistoryModalProps {
  src: BrdSource;
  onClose: () => void;
}
function HistoryModal({ src, onClose }: HistoryModalProps) {
  const history = buildHistory(src);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-sm z-10">
        <Card className="shadow-2xl">
          <CardHeader
            title="Version History"
            subtitle={`${src.id} — ${src.title.length > 34 ? src.title.slice(0, 34) + "…" : src.title}`}
            action={
              <button
                onClick={onClose}
                className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <CloseIcon />
              </button>
            }
          />
          <div className="p-5 space-y-3">
            <div className="relative">
              <div className="absolute left-[19px] top-5 bottom-5 w-px bg-slate-300 dark:bg-slate-700" />
              <div className="space-y-3">
                {history.map((h, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div
                      className={`w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center border-2 z-10 ${
                        h.latest
                          ? "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-400 dark:border-emerald-600"
                          : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700"
                      }`}
                    >
                      {h.latest ? (
                        <svg
                          className="w-4 h-4 text-emerald-600"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2.5}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      ) : (
                        <svg
                          className="w-3.5 h-3.5 text-slate-500"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                      )}
                    </div>
                    <div
                      className={`flex-1 flex items-center justify-between p-3 rounded-xl border ${
                        h.latest
                          ? "bg-emerald-50/80 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-900/40"
                          : "bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700/60"
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-bold text-slate-800 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-2 py-0.5 rounded-md">
                            {h.ver}
                          </span>
                          {h.latest && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800">
                              Latest
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mt-1">
                          {h.note}
                        </div>
                      </div>
                      <span className="font-mono text-[10px] font-medium text-slate-500 whitespace-nowrap ml-3">
                        {h.date}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <Button
              variant="secondary"
              className="w-full justify-center"
              onClick={onClose}
            >
              Close
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── New BRD Modal ─────────────────────────────────────────────────────────────
interface NewBrdModalProps {
  onAdd: (src: BrdSource) => void;
  onClose: () => void;
  nextId: string;
}
function NewBrdModal({ onAdd, onClose, nextId }: NewBrdModalProps) {
  const [title, setTitle] = useState("");
  const [geo, setGeo] = useState("");
  const [status, setStatus] = useState<BrdStatus>("Draft");

  const handleAdd = () => {
    if (!title.trim()) return;
    onAdd({
      id: nextId,
      title: title.trim(),
      geography: geo.trim() || "Global",
      status,
      version: "v1.0",
      lastUpdated: today(),
      editCount: 0,
      comments: [],
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md z-10">
        <Card className="shadow-2xl">
          <CardHeader
            title="New BRD Source"
            subtitle="Create a new requirements document"
            action={
              <button
                onClick={onClose}
                className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <CloseIcon />
              </button>
            }
          />
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Document Title <span className="text-red-500">*</span>
              </label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Fair Work Regulations 2024"
                className="w-full text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Geography
              </label>
              <input
                value={geo}
                onChange={(e) => setGeo(e.target.value)}
                placeholder="e.g. Australia"
                className="w-full text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Initial Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as BrdStatus)}
                className="w-full text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {(
                  ["Draft", "Processing", "Ready", "Reviewed"] as BrdStatus[]
                ).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                variant="secondary"
                className="flex-1 justify-center"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 justify-center"
                onClick={handleAdd}
                disabled={!title.trim()}
              >
                Create BRD
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

interface AssignTaskModalProps {
  src: BrdSource;
  teamMembers: { id: number; userId: string; name: string }[];
  onAssign: (payload: {
    brd: BrdSource;
    assigneeId: number;
    dueDate: string;
    priority: "High" | "Medium" | "Low";
  }) => void;
  onClose: () => void;
}

function AssignTaskModal({
  src,
  teamMembers,
  onAssign,
  onClose,
}: AssignTaskModalProps) {
  const [assigneeId, setAssigneeId] = useState<number>(teamMembers[0]?.id ?? 0);
  const [dueDate, setDueDate] = useState(today());
  const [priority, setPriority] = useState<"High" | "Medium" | "Low">("Medium");

  const canAssign = assigneeId > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md z-10">
        <Card className="shadow-2xl">
          <CardHeader
            title="Assign Task"
            subtitle={`${src.id} - ${src.title}`}
            action={
              <button
                onClick={onClose}
                className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <CloseIcon />
              </button>
            }
          />
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Assign to User
              </label>
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(parseInt(e.target.value, 10))}
                className="w-full text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {teamMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name} ({member.userId})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Due Date
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Priority
                </label>
                <select
                  value={priority}
                  onChange={(e) =>
                    setPriority(e.target.value as "High" | "Medium" | "Low")
                  }
                  className="w-full text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                variant="secondary"
                className="flex-1 justify-center"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 justify-center"
                disabled={!canAssign}
                onClick={() =>
                  onAssign({ brd: src, assigneeId, dueDate, priority })
                }
              >
                Assign
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function MyTaskPage() {
  const { user: currentUser } = useAuth();
  const { users } = useUsers();

  const currentTeamSlug = (
    currentUser?.team?.slug ||
    currentUser?.team?.name ||
    ""
  ).toLowerCase();
  const isPreProd = currentTeamSlug.includes("pre-production");
  const isProdUpdate =
    currentTeamSlug === "production" || currentTeamSlug === "updating";

  const [brdSources, setBrdSources] =
    useState<BrdSource[]>(INITIAL_BRD_SOURCES);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterKey>("All");

  // Modals
  const [viewSrc, setViewSrc] = useState<BrdSource | null>(null);
  const [editSrc, setEditSrc] = useState<BrdSource | null>(null);
  const [historySrc, setHistorySrc] = useState<BrdSource | null>(null);
  const [showNewBrd, setShowNewBrd] = useState(false);
  const [commentSrc, setCommentSrc] = useState<BrdSource | null>(null);
  const [assignSrc, setAssignSrc] = useState<BrdSource | null>(null);

  // BrdFlow
  const [showBrdFlow, setShowBrdFlow] = useState(false);
  const [flowInitialStep, setFlowInitialStep] = useState(0);
  const [flowFinalMode, setFlowFinalMode] = useState<"generate" | "view">(
    "generate",
  );
  const [flowInitialMeta, setFlowInitialMeta] = useState<{
    format: "new" | "old";
    brdId: string;
    title: string;
  } | null>(null);

  const statusCounts = brdSources.reduce<Record<string, number>>((acc, b) => {
    acc[b.status] = (acc[b.status] || 0) + 1;
    return acc;
  }, {});

  const teamMembers = !currentUser?.teamId
    ? []
    : users
        .filter(
          (u) =>
            u.teamId === currentUser.teamId &&
            u.status === "ACTIVE" &&
            u.role === "USER",
        )
        .map((u) => ({
          id: u.id,
          userId: u.userId,
          name:
            [u.firstName, u.lastName].filter(Boolean).join(" ").trim() ||
            u.userId,
        }));

  // Role-filtered BRD sources
  const visibleSources = isProdUpdate
    ? brdSources.filter((b) => b.status === "Reviewed") // prod/update: only Reviewed
    : brdSources;

  const filtered = visibleSources.filter((b) => {
    const q = search.toLowerCase();
    const matchSearch =
      b.title.toLowerCase().includes(q) ||
      b.id.toLowerCase().includes(q) ||
      b.geography.toLowerCase().includes(q);
    return matchSearch && (activeFilter === "All" || b.status === activeFilter);
  });

  const handleRemove = (id: string) =>
    setBrdSources((prev) => prev.filter((b) => b.id !== id));
  const handleSaveEdit = (updated: BrdSource) => {
    setBrdSources((prev) =>
      prev.map((b) => (b.id === updated.id ? updated : b)),
    );
    setEditSrc(null);
  };
  const handleAddNew = (src: BrdSource) =>
    setBrdSources((prev) => [...prev, src]);

  const nextId = `BRD-${String(brdSources.length + 1).padStart(3, "0")}`;

  // Tasks (only relevant for production/updating role)
  const [assignedTasks, setAssignedTasks] =
    useState<AssignedTask[]>(INITIAL_TASKS);

  const handleAssignTask = ({
    brd,
    assigneeId,
    dueDate,
    priority,
  }: {
    brd: BrdSource;
    assigneeId: number;
    dueDate: string;
    priority: "High" | "Medium" | "Low";
  }) => {
    const assignee = teamMembers.find((member) => member.id === assigneeId);
    if (!assignee) return;

    setAssignedTasks((prev) => [
      {
        id: `TASK-${String(prev.length + 1).padStart(3, "0")}`,
        taskName: `Review ${brd.title}`,
        assignedTo: assignee.name,
        assigneeId,
        dueDate,
        priority,
        brdSourceId: brd.id,
      },
      ...prev,
    ]);
    setAssignSrc(null);
  };

  if (showBrdFlow) {
    return (
      <div className="h-full w-full">
        <BrdFlow
          initialStep={flowInitialStep}
          finalStepMode={flowFinalMode}
          initialMeta={flowInitialMeta}
          onClose={() => setShowBrdFlow(false)}
        />
      </div>
    );
  }

  return (
    <div className="h-full w-full min-h-0 px-6 py-5 text-xs flex flex-col gap-5">
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
            {isProdUpdate ? "My Tasks" : "My Tasks & BRD Sources"}
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
            {isProdUpdate
              ? "Your assigned tasks and reviewed BRD sources"
              : "Manage your tasks and business requirements documents"}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 lg:w-full lg:max-w-xl">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search title, ID, geography…"
            className="w-full sm:min-w-72 lg:flex-1"
          />
          {isPreProd && (
            <Button size="md" onClick={() => setShowNewBrd(true)}>
              <PlusIcon /> New BRD
            </Button>
          )}
        </div>
      </div>

      {/* ── Stat Cards ── */}
      {isPreProd && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {[
            {
              label: "Total Documents",
              value: brdSources.length,
              gradient:
                "from-indigo-50 to-blue-50 dark:from-indigo-950/60 dark:to-blue-950/60",
              border: "border-indigo-200 dark:border-indigo-900/50",
              numClass: "text-indigo-800 dark:text-indigo-300",
              lblClass: "text-indigo-600 dark:text-indigo-500",
              iconBg: "bg-indigo-100 dark:bg-indigo-900/50",
              icon: (
                <svg
                  className="w-5 h-5 text-indigo-700 dark:text-indigo-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.75}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              ),
            },
            {
              label: "Reviewed",
              value: statusCounts["Reviewed"] || 0,
              gradient:
                "from-violet-50 to-purple-50 dark:from-violet-950/60 dark:to-purple-950/60",
              border: "border-violet-200 dark:border-violet-900/50",
              numClass: "text-violet-800 dark:text-violet-300",
              lblClass: "text-violet-600 dark:text-violet-500",
              iconBg: "bg-violet-100 dark:bg-violet-900/50",
              icon: (
                <svg
                  className="w-5 h-5 text-violet-700 dark:text-violet-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.75}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              ),
            },
            {
              label: "Ready",
              value: statusCounts["Ready"] || 0,
              gradient:
                "from-emerald-50 to-teal-50 dark:from-emerald-950/60 dark:to-teal-950/60",
              border: "border-emerald-200 dark:border-emerald-900/50",
              numClass: "text-emerald-800 dark:text-emerald-300",
              lblClass: "text-emerald-600 dark:text-emerald-500",
              iconBg: "bg-emerald-100 dark:bg-emerald-900/50",
              icon: (
                <svg
                  className="w-5 h-5 text-emerald-700 dark:text-emerald-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.75}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              ),
            },
            {
              label: "Processing",
              value: statusCounts["Processing"] || 0,
              gradient:
                "from-sky-50 to-cyan-50 dark:from-sky-950/60 dark:to-cyan-950/60",
              border: "border-sky-200 dark:border-sky-900/50",
              numClass: "text-sky-800 dark:text-sky-300",
              lblClass: "text-sky-600 dark:text-sky-500",
              iconBg: "bg-sky-100 dark:bg-sky-900/50",
              icon: (
                <svg
                  className="w-5 h-5 text-sky-600 dark:text-sky-400 animate-spin"
                  style={{ animationDuration: "3s" }}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.75}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              ),
            },
          ].map((s) => (
            <div
              key={s.label}
              className={`rounded-2xl p-4 flex items-center gap-3.5 bg-gradient-to-br ${s.gradient} border ${s.border} hover:shadow-md transition-shadow`}
            >
              <div
                className={`w-10 h-10 rounded-xl ${s.iconBg} flex items-center justify-center flex-shrink-0`}
              >
                {s.icon}
              </div>
              <div>
                <div
                  className={`text-2xl font-bold leading-none ${s.numClass}`}
                >
                  {s.value}
                </div>
                <div className={`text-xs mt-1 font-semibold ${s.lblClass}`}>
                  {s.label}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Production: Assigned Tasks section ── */}
      {isProdUpdate && (
        <Card className="overflow-hidden">
          <CardHeader
            title="All Assigned Tasks"
            subtitle="Tasks you have assigned to team members"
          />
          <div className="overflow-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700">
                  {[
                    "Task ID",
                    "Task Name",
                    "Linked BRD",
                    "Priority",
                    "Due Date",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-center font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest text-[10px] whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {assignedTasks.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-16 text-center text-slate-400 dark:text-slate-500"
                    >
                      <div className="text-4xl mb-2">📋</div>
                      <div className="text-2xl font-semibold mb-1">
                        No tasks yet
                      </div>
                      <div className="text-lg">
                        Assign a BRD source above to create a task for your
                        team.
                      </div>
                    </td>
                  </tr>
                ) : (
                  assignedTasks.map((task, idx) => (
                    <tr
                      key={task.id}
                      className={`group transition-colors hover:bg-blue-50/60 dark:hover:bg-slate-800/50 ${idx % 2 === 0 ? "bg-white dark:bg-transparent" : "bg-slate-50/60 dark:bg-slate-800/20"}`}
                    >
                      <td className="px-4 py-3.5 whitespace-nowrap text-center">
                        <span className="font-mono text-xs text-slate-600 dark:text-slate-500 bg-slate-100 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 px-2.5 py-1 rounded-lg">
                          {task.id}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-center">
                        <span className="text-xs font-light text-slate-900 dark:text-slate-200">
                          {task.taskName}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-center">
                        <span className="inline-flex items-center gap-1 font-mono text-xs text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800/50 px-2.5 py-1 rounded-lg">
                          <TagIcon />
                          {task.brdSourceId}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-center">
                        <Badge
                          className={`font-medium ${PRIORITY_BADGE[task.priority]}`}
                        >
                          {task.priority}
                        </Badge>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-center">
                        <span className="font-mono text-xs text-slate-600 dark:text-slate-500">
                          {task.dueDate}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── BRD Sources Section header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200">
            BRD Sources
            {isProdUpdate && (
              <span className="ml-2 text-[10px] font-semibold text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800/40 px-2 py-0.5 rounded-full">
                Reviewed only
              </span>
            )}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {isProdUpdate
              ? "Showing reviewed documents available for your role"
              : "All business requirement document sources"}
          </p>
        </div>
        {/* Filter chips */}
        {isPreProd && (
          <div className="flex flex-wrap items-center gap-2">
            {FILTER_CHIPS.map((chip) => {
              const count =
                chip === "All" ? brdSources.length : statusCounts[chip] || 0;
              const on = activeFilter === chip;
              const styles = FILTER_CHIP_STYLES[chip];
              return (
                <button
                  key={chip}
                  onClick={() => setActiveFilter(chip)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all duration-150 whitespace-nowrap ${on ? styles.active : styles.base}`}
                >
                  <span className="font-mono font-bold">{count}</span>
                  {chip}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── BRD Sources Table ── */}
      <Card className="overflow-hidden flex-1 min-h-0">
        <div className="h-full overflow-auto scrollbar-hide">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700">
                <th className="px-4 py-3 text-center font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest text-[10px] whitespace-nowrap">
                  BRD ID
                </th>
                <th className="px-4 py-3 text-center font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest text-[10px] whitespace-nowrap">
                  Document Title
                </th>
                <th className="px-4 py-3 text-center font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest text-[10px] whitespace-nowrap">
                  Geography
                </th>
                <th className="px-4 py-3 text-center font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest text-[10px] whitespace-nowrap">
                  Status
                </th>
                <th className="px-4 py-3 text-center font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest text-[10px] whitespace-nowrap">
                  Version
                </th>
                <th className="px-4 py-3 text-center font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest text-[10px] whitespace-nowrap">
                  Last Updated
                </th>
                <th className="px-4 py-3 text-center font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest text-[10px] whitespace-nowrap">
                  Comments
                </th>
                <th className="px-4 py-3 text-center font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest text-[10px] whitespace-nowrap">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-12 text-center text-slate-400 dark:text-slate-500"
                  >
                    <div className="text-2xl mb-2">📂</div>
                    <div className="font-medium">
                      {isProdUpdate
                        ? "No reviewed BRD sources found."
                        : "No BRDs found — try adjusting your search or filter."}
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((brd, idx) => (
                  <tr
                    key={brd.id}
                    className={`group transition-colors hover:bg-blue-50/60 dark:hover:bg-slate-800/50 ${idx % 2 === 0 ? "bg-white dark:bg-transparent" : "bg-slate-50/60 dark:bg-slate-800/20"}`}
                  >
                    {/* BRD ID */}
                    <td className="px-4 py-3.5 whitespace-nowrap text-center">
                      <span className="inline-flex items-center gap-1.5 font-mono text-xs font-normal text-slate-600 dark:text-slate-500 bg-slate-100 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 px-2.5 py-1 rounded-lg">
                        <TagIcon />
                        {brd.id}
                      </span>
                    </td>
                    {/* Title */}
                    <td className="px-4 py-3.5 whitespace-nowrap text-center">
                      <span className="text-xs font-light text-slate-900 dark:text-slate-200">
                        {brd.title}
                      </span>
                    </td>
                    {/* Geography */}
                    <td className="px-4 py-3.5 whitespace-nowrap text-center">
                      <span className="text-xs font-normal text-slate-700 dark:text-slate-400">
                        {brd.geography}
                      </span>
                    </td>
                    {/* Status */}
                    <td className="px-4 py-3.5 whitespace-nowrap text-center">
                      <Badge
                        className={`inline-flex items-center gap-1.5 font-medium ${STATUS_BADGE[brd.status]}`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                            brd.status === "Processing"
                              ? "bg-sky-500 animate-pulse"
                              : brd.status === "Reviewed"
                                ? "bg-violet-600"
                                : brd.status === "Ready"
                                  ? "bg-emerald-600"
                                  : "bg-slate-500"
                          }`}
                        />
                        {brd.status}
                      </Badge>
                    </td>
                    {/* Version */}
                    <td className="px-4 py-3.5 whitespace-nowrap text-center">
                      <span className="font-mono text-xs font-normal text-slate-700 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 px-2.5 py-1 rounded-lg">
                        {brd.version}
                      </span>
                    </td>
                    {/* Last Updated */}
                    <td className="px-4 py-3.5 whitespace-nowrap text-center">
                      <span className="font-mono text-xs font-normal text-slate-600 dark:text-slate-500">
                        {brd.lastUpdated}
                      </span>
                    </td>
                    {/* Comment Queries icon */}
                    <td className="px-4 py-3.5 whitespace-nowrap text-center">
                      <button
                        onClick={() => setCommentSrc(brd)}
                        className="relative inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 bg-slate-50 dark:bg-slate-800/50 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700 transition-all"
                        title="Comment Queries"
                      >
                        <CommentIcon />
                        {brd.comments.length > 0 && (
                          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[9px] font-bold bg-indigo-600 text-white flex items-center justify-center">
                            {brd.comments.length}
                          </span>
                        )}
                      </button>
                    </td>
                    {/* Actions */}
                    <td className="px-4 py-3.5 whitespace-nowrap text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {isProdUpdate && (
                          <button
                            type="button"
                            onClick={() => setAssignSrc(brd)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-sky-700 dark:text-sky-400 bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800/50 hover:bg-sky-100 dark:hover:bg-sky-900/40 transition-all"
                            disabled={teamMembers.length === 0}
                            title={
                              teamMembers.length === 0
                                ? "No active team users available"
                                : "Assign task"
                            }
                          >
                            <UserIcon /> Assign
                          </button>
                        )}

                        {/* View — available to all roles */}
                        <button
                          type="button"
                          onClick={() => {
                            setFlowFinalMode("view");
                            setFlowInitialStep(6);
                            setFlowInitialMeta({
                              format: "new",
                              brdId: brd.id,
                              title: brd.title,
                            });
                            setShowBrdFlow(true);
                          }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-all"
                        >
                          <EyeIcon /> View
                        </button>

                        {/* Edit, History, Remove — Pre-Production only */}
                        {isPreProd && (
                          <>
                            <button
                              onClick={() => setEditSrc(brd)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all"
                            >
                              <EditIcon /> Edit
                            </button>
                            <button
                              onClick={() => setHistorySrc(brd)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-violet-700 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800/50 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-all"
                            >
                              <HistoryIcon /> History
                            </button>
                            <button
                              onClick={() => handleRemove(brd.id)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 hover:bg-red-100 dark:hover:bg-red-900/40 transition-all"
                            >
                              <TrashIcon /> Remove
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Modals ── */}
      {showNewBrd && (
        <NewBrdModal
          onAdd={handleAddNew}
          onClose={() => setShowNewBrd(false)}
          nextId={nextId}
        />
      )}
      {editSrc && (
        <EditModal
          src={editSrc}
          onSave={handleSaveEdit}
          onClose={() => setEditSrc(null)}
        />
      )}
      {historySrc && (
        <HistoryModal src={historySrc} onClose={() => setHistorySrc(null)} />
      )}
      {viewSrc && (
        <ViewModal
          src={viewSrc}
          onClose={() => setViewSrc(null)}
          readOnly={isProdUpdate}
        />
      )}
      {commentSrc && (
        <ViewModal
          src={commentSrc}
          onClose={() => {
            // sync comment changes back to source list
            setBrdSources((prev) =>
              prev.map((b) => (b.id === commentSrc.id ? { ...b } : b)),
            );
            setCommentSrc(null);
          }}
          readOnly={isProdUpdate}
        />
      )}
      {assignSrc && (
        <AssignTaskModal
          src={assignSrc}
          teamMembers={teamMembers}
          onAssign={handleAssignTask}
          onClose={() => setAssignSrc(null)}
        />
      )}
    </div>
  );
}
