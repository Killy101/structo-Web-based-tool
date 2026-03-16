"use client";
import React, { useState } from "react";
import { useTaskComments } from "../../hooks";
import { useAuth } from "../../context/AuthContext";
import { formatTimeAgo, getInitials } from "../../utils";
import { Spinner } from "../ui";

interface TaskCommentsProps {
  taskId: number;
}

export default function TaskComments({ taskId }: TaskCommentsProps) {
  const { user } = useAuth();
  const { comments, isLoading, addComment, deleteComment } =
    useTaskComments(taskId);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      await addComment(trimmed);
      setBody("");
    } catch {
      setError("Failed to post comment. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (commentId: number) => {
    try {
      await deleteComment(commentId);
    } catch {
      // silent
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
        Comments ({comments.length})
      </p>

      {/* Comment list */}
      {isLoading ? (
        <div className="flex justify-center py-4">
          <Spinner className="w-5 h-5" />
        </div>
      ) : comments.length === 0 ? (
        <p className="text-sm text-slate-400 italic">
          No comments yet. Be the first to comment.
        </p>
      ) : (
        <div className="space-y-3">
          {comments.map((c) => {
            const authorName =
              [c.author?.firstName, c.author?.lastName]
                .filter(Boolean)
                .join(" ") || c.author?.userId || "Unknown";
            const initials = getInitials(c.author?.firstName, c.author?.lastName);
            const canDelete =
              user?.id === c.authorId ||
              user?.role === "ADMIN" ||
              user?.role === "SUPER_ADMIN";

            return (
              <div
                key={c.id}
                className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700"
              >
                {/* Avatar */}
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center text-[11px] font-bold text-white">
                  {initials || "?"}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      {authorName}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {formatTimeAgo(c.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">
                    {c.body}
                  </p>
                </div>

                {canDelete && (
                  <button
                    onClick={() => handleDelete(c.id)}
                    className="text-xs text-slate-400 hover:text-red-500 transition-colors flex-shrink-0"
                    title="Delete comment"
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Input form */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a comment…"
          rows={2}
          className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting || !body.trim()}
            className="px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "Posting…" : "Post Comment"}
          </button>
        </div>
      </form>
    </div>
  );
}
