"use client";
import React from "react";
import { Toast, ToastType } from "../../types";

// ─── BADGE ─────────────────────────────────────────────────────────────────────
export const Badge = ({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <span
    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${className}`}
  >
    {children}
  </span>
);

// ─── BUTTON ────────────────────────────────────────────────────────────────────
type BtnVariant =
  | "primary"
  | "secondary"
  | "danger"
  | "ghost"
  | "success"
  | "warning";
type BtnSize = "xs" | "sm" | "md" | "lg";

interface BtnProps {
  children: React.ReactNode;
  variant?: BtnVariant;
  size?: BtnSize;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  loading?: boolean;
}

export const Button = ({
  children,
  variant = "primary",
  size = "md",
  onClick,
  className = "",
  disabled,
  type = "button",
  loading,
}: BtnProps) => {
  const sizes: Record<BtnSize, string> = {
    xs: "px-2 py-1 text-xs gap-1",
    sm: "px-3 py-1.5 text-xs gap-1.5",
    md: "px-4 py-2 text-sm gap-2",
    lg: "px-6 py-3 text-base gap-2",
  };
  const variants: Record<BtnVariant, string> = {
    primary: "bg-[#1a56f0] hover:bg-[#1648d0] text-white shadow-sm",
    secondary:
      "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700",
    danger: "bg-red-500 hover:bg-red-600 text-white",
    ghost:
      "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800",
    success: "bg-emerald-500 hover:bg-emerald-600 text-white",
    warning: "bg-amber-500 hover:bg-amber-600 text-white",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex items-center font-medium rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {loading && (
        <svg
          className="animate-spin w-3.5 h-3.5"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      {children}
    </button>
  );
};

// ─── CARD ──────────────────────────────────────────────────────────────────────
export const Card = ({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    className={`bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm ${className}`}
  >
    {children}
  </div>
);

export const CardHeader = ({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) => (
  <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
    <div>
      <h3 className="font-semibold text-slate-900 dark:text-white">{title}</h3>
      {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
    </div>
    {action && <div>{action}</div>}
  </div>
);

// ─── INPUT ─────────────────────────────────────────────────────────────────────
interface InputProps {
  label?: string;
  type?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  className?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  autoComplete?: string;
}
export const Input = ({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  className = "",
  error,
  required,
  disabled,
  autoComplete,
}: InputProps) => (
  <div className={`space-y-1.5 ${className}`}>
    {label && (
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
    )}
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      required={required}
      disabled={disabled}
      autoComplete={autoComplete}
      className={`w-full px-3 py-2.5 rounded-lg border text-sm transition-all
        bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400
        focus:outline-none focus:ring-2 focus:ring-[#1a56f0] focus:border-transparent
        disabled:opacity-50 disabled:cursor-not-allowed
        ${error ? "border-red-400 dark:border-red-500" : "border-slate-200 dark:border-slate-700"}`}
    />
    {error && <p className="text-xs text-red-500">{error}</p>}
  </div>
);

// ─── TEXTAREA ──────────────────────────────────────────────────────────────────
interface TextareaProps {
  label?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  className?: string;
  rows?: number;
}
export const Textarea = ({
  label,
  value,
  onChange,
  placeholder,
  className = "",
  rows = 3,
}: TextareaProps) => (
  <div className={`space-y-1.5 ${className}`}>
    {label && (
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>
    )}
    <textarea
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={rows}
      className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1a56f0] focus:border-transparent resize-none"
    />
  </div>
);

// ─── SELECT ────────────────────────────────────────────────────────────────────
interface SelectProps {
  label?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  children: React.ReactNode;
  className?: string;
  error?: string;
  required?: boolean;
}
export const Select = ({
  label,
  value,
  onChange,
  children,
  className = "",
  error,
  required,
}: SelectProps) => (
  <div className={`space-y-1.5 ${className}`}>
    {label && (
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
    )}
    <select
      value={value}
      onChange={onChange}
      required={required}
      className={`w-full px-3 py-2.5 rounded-lg border text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white
        focus:outline-none focus:ring-2 focus:ring-[#1a56f0] focus:border-transparent
        ${error ? "border-red-400" : "border-slate-200 dark:border-slate-700"}`}
    >
      {children}
    </select>
    {error && <p className="text-xs text-red-500">{error}</p>}
  </div>
);

// ─── MODAL ─────────────────────────────────────────────────────────────────────
interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg";
}
export const Modal = ({
  isOpen,
  onClose,
  title,
  children,
  size = "md",
}: ModalProps) => {
  if (!isOpen) return null;
  const sizes = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg" };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={`relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full ${sizes[size]} border border-slate-200 dark:border-slate-700 max-h-[90vh] flex flex-col`}
      >
        <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
            {title}
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <svg
              className="w-5 h-5"
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
          </button>
        </div>
        <div className="p-6 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
};

// ─── AVATAR ────────────────────────────────────────────────────────────────────
export const Avatar = ({
  firstName,
  lastName,
  size = "md",
  className = "",
}: {
  firstName: string;
  lastName: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) => {
  const sizes = {
    sm: "w-7 h-7 text-xs",
    md: "w-9 h-9 text-sm",
    lg: "w-11 h-11 text-base",
  };
  return (
    <div
      className={`${sizes[size]} rounded-full bg-linear-to-br from-[#1a56f0] to-purple-500 flex items-center justify-center text-white font-bold shrink-0 ${className}`}
    >
      {firstName?.[0]}
      {lastName?.[0]}
    </div>
  );
};

// ─── SPINNER ───────────────────────────────────────────────────────────────────
export const Spinner = ({ className = "w-6 h-6" }: { className?: string }) => (
  <svg
    className={`animate-spin text-[#1a56f0] ${className}`}
    fill="none"
    viewBox="0 0 24 24"
  >
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
    />
  </svg>
);

// ─── EMPTY STATE ───────────────────────────────────────────────────────────────
export const EmptyState = ({
  icon = "📭",
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) => (
  <div className="flex flex-col items-center justify-center py-16 text-center px-4">
    <div className="text-5xl mb-4">{icon}</div>
    <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
      {title}
    </h3>
    {description && (
      <p className="text-sm text-slate-500 max-w-sm mb-4">{description}</p>
    )}
    {action}
  </div>
);

// ─── SEARCH INPUT ──────────────────────────────────────────────────────────────
export const SearchInput = ({
  value,
  onChange,
  placeholder = "Search...",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) => (
  <div className={`relative ${className}`}>
    <svg
      className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    </svg>
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1a56f0] transition-all"
    />
  </div>
);

// ─── STAT CARD ─────────────────────────────────────────────────────────────────
export const StatCard = ({
  label,
  value,
  change,
  icon,
  color,
}: {
  label: string;
  value: string | number;
  change?: string;
  icon: string;
  color: "blue" | "violet" | "amber" | "emerald" | "red";
}) => {
  const colorMap: Record<string, string> = {
    blue: "from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 text-blue-600 dark:text-blue-400",
    violet:
      "from-violet-50 to-violet-100 dark:from-violet-900/20 dark:to-violet-800/20 text-violet-600 dark:text-violet-400",
    amber:
      "from-amber-50 to-amber-100 dark:from-amber-900/20 dark:to-amber-800/20 text-amber-600 dark:text-amber-400",
    emerald:
      "from-emerald-50 to-emerald-100 dark:from-emerald-900/20 dark:to-emerald-800/20 text-emerald-600 dark:text-emerald-400",
    red: "from-red-50 to-red-100 dark:from-red-900/20 dark:to-red-800/20 text-red-600 dark:text-red-400",
  };
  const isPos = change?.startsWith("+");
  return (
    <Card className="p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div
          className={`w-11 h-11 rounded-xl bg-linear-to-br ${colorMap[color]} flex items-center justify-center text-xl`}
        >
          {icon}
        </div>
        {change && (
          <span
            className={`text-xs font-medium px-2 py-1 rounded-full ${isPos ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400"}`}
          >
            {change}
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-slate-900 dark:text-white">
        {value}
      </p>
      <p className="text-sm text-slate-500 mt-1">{label}</p>
    </Card>
  );
};

// ─── TOAST CONTAINER ───────────────────────────────────────────────────────────
const TOAST_STYLES: Record<ToastType, string> = {
  success:
    "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300",
  error:
    "bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300",
  warning:
    "bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300",
  info: "bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300",
};
const TOAST_ICONS: Record<ToastType, string> = {
  success: "✅",
  error: "❌",
  warning: "⚠️",
  info: "ℹ️",
};

export const ToastContainer = ({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) => (
  <div className="fixed bottom-4 right-4 z-50 space-y-2 w-80 pointer-events-none">
    {toasts.map((t) => (
      <div
        key={t.id}
        className={`flex items-start gap-3 p-4 rounded-xl border shadow-lg text-sm pointer-events-auto ${TOAST_STYLES[t.type]}`}
      >
        <span>{TOAST_ICONS[t.type]}</span>
        <span className="flex-1">{t.message}</span>
        <button
          onClick={() => onDismiss(t.id)}
          className="opacity-60 hover:opacity-100 transition-opacity"
        >
          ✕
        </button>
      </div>
    ))}
  </div>
);

// ─── GENERIC TABLE ─────────────────────────────────────────────────────────────
interface Col<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  className?: string;
}
interface TableProps<T> {
  columns: Col<T>[];
  data: T[];
  keyExtractor: (row: T) => string | number;
  isLoading?: boolean;
  emptyMessage?: string;
  emptyIcon?: string;
}
export function Table<T>({
  columns,
  data,
  keyExtractor,
  isLoading,
  emptyMessage,
  emptyIcon,
}: TableProps<T>) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="bg-slate-50 dark:bg-slate-800/50">
            {columns.map((c) => (
              <th
                key={c.key}
                className={`text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap ${c.className ?? ""}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
          {isLoading ? (
            <tr>
              <td colSpan={columns.length} className="py-16 text-center">
                <div className="flex flex-col items-center gap-2">
                  <Spinner />
                  <p className="text-sm text-slate-400">Loading...</p>
                </div>
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>
                <EmptyState
                  icon={emptyIcon}
                  title={emptyMessage ?? "No data found"}
                />
              </td>
            </tr>
          ) : (
            data.map((row) => (
              <tr
                key={keyExtractor(row)}
                className="hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors"
              >
                {columns.map((c) => (
                  <td key={c.key} className={`px-6 py-4 ${c.className ?? ""}`}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
