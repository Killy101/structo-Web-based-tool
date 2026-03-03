"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import api from "@/app/lib/api";
import axios from "axios";

interface FormErrors {
  newPassword?: string;
  confirmPassword?: string;
  general?: string;
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [formData, setFormData] = useState({
    newPassword: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function validate(): boolean {
    const e: FormErrors = {};

    if (!token) {
      e.general =
        "Invalid or missing reset token. Please request a new reset link.";
      setErrors(e);
      return false;
    }

    if (!formData.newPassword) {
      e.newPassword = "New password is required";
    } else if (formData.newPassword.length < 8) {
      e.newPassword = "Must be at least 8 characters";
    } else if (!/[A-Z]/.test(formData.newPassword)) {
      e.newPassword = "Must include at least one uppercase letter";
    } else if (!/[a-z]/.test(formData.newPassword)) {
      e.newPassword = "Must include at least one lowercase letter";
    } else if (!/[0-9]/.test(formData.newPassword)) {
      e.newPassword = "Must include at least one number";
    }

    if (!formData.confirmPassword) {
      e.confirmPassword = "Please confirm your new password";
    } else if (formData.newPassword !== formData.confirmPassword) {
      e.confirmPassword = "Passwords do not match";
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function getPasswordStrength(): {
    level: number;
    label: string;
    color: string;
  } {
    const pw = formData.newPassword;
    if (!pw) return { level: 0, label: "", color: "" };

    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[a-z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^a-zA-Z0-9]/.test(pw)) score++;

    if (score <= 2) return { level: 1, label: "Weak", color: "bg-red-500" };
    if (score <= 4) return { level: 2, label: "Medium", color: "bg-amber-500" };
    return { level: 3, label: "Strong", color: "bg-emerald-500" };
  }

  const strength = getPasswordStrength();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});

    if (!validate()) return;

    setLoading(true);

    try {
      await api.post("/auth/reset-password", {
        token,
        newPassword: formData.newPassword,
      });
      setSuccess(true);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        setErrors({
          general:
            err.response?.data?.error ||
            "Something went wrong. The link may have expired.",
        });
      } else {
        setErrors({ general: "Network error. Please try again." });
      }
    } finally {
      setLoading(false);
    }
  }

  // Reusable eye toggle
  function EyeToggle({
    show,
    onToggle,
  }: {
    show: boolean;
    onToggle: () => void;
  }) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
        tabIndex={-1}
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? (
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <line x1="1" y1="1" x2="23" y2="23" strokeWidth="2" />
          </svg>
        ) : (
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="12" r="3" strokeWidth="2" />
          </svg>
        )}
      </button>
    );
  }

  // No token at all
  if (!token) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-100 to-blue-50 flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
            <div className="bg-gradient-to-r from-slate-900 to-slate-800 px-6 py-4 flex items-center gap-2">
              <svg
                className="w-4 h-4 text-red-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <circle cx="12" cy="12" r="10" strokeWidth="2" />
                <path d="M12 8v4m0 4h.01" strokeWidth="2" />
              </svg>
              <span className="text-sm font-semibold text-white tracking-wide">
                Invalid Link
              </span>
            </div>
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8 text-red-500"
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
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-2">
                Invalid Reset Link
              </h2>
              <p className="text-sm text-slate-500 mb-6">
                This password reset link is invalid or has expired. Please
                request a new one.
              </p>
              <Link
                href="/login"
                className="inline-block w-full bg-[#1a56f0] hover:bg-[#1545d0] text-white font-semibold py-3 px-4 rounded-xl text-sm transition-colors text-center"
              >
                Back to Login
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-blue-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          {/* Header bar */}
          <div className="bg-gradient-to-r from-slate-900 to-slate-800 px-6 py-4 flex items-center gap-2">
            <svg
              className="w-4 h-4 text-blue-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <rect
                x="3"
                y="11"
                width="18"
                height="11"
                rx="2"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M7 11V7a5 5 0 0 1 10 0v4"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="text-sm font-semibold text-white tracking-wide">
              Reset Password
            </span>
          </div>

          <div className="p-6">
            {!success ? (
              <>
                {/* Icon */}
                <div className="flex items-center justify-center w-14 h-14 bg-blue-50 rounded-full mx-auto mb-4">
                  <svg
                    className="w-7 h-7 text-[#1a56f0]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                    />
                  </svg>
                </div>

                <h2 className="text-xl font-bold text-slate-900 text-center mb-1">
                  Set a new password
                </h2>
                <p className="text-sm text-slate-500 text-center mb-6">
                  Enter your new password below.
                </p>

                {/* General Error */}
                {errors.general && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2">
                    <svg
                      className="w-4 h-4 text-red-500 mt-0.5 shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <circle cx="12" cy="12" r="10" strokeWidth="2" />
                      <path d="M12 8v4m0 4h.01" strokeWidth="2" />
                    </svg>
                    <p className="text-sm text-red-600">{errors.general}</p>
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                  {/* New Password */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                      New Password
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <rect
                            x="3"
                            y="11"
                            width="18"
                            height="11"
                            rx="2"
                            strokeWidth="2"
                          />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" strokeWidth="2" />
                        </svg>
                      </span>
                      <input
                        ref={inputRef}
                        type={showNewPassword ? "text" : "password"}
                        value={formData.newPassword}
                        onChange={(e) => {
                          setFormData({
                            ...formData,
                            newPassword: e.target.value,
                          });
                          if (errors.newPassword)
                            setErrors((prev) => ({
                              ...prev,
                              newPassword: undefined,
                            }));
                        }}
                        placeholder="At least 8 characters"
                        className={`w-full pl-10 pr-10 py-3 text-sm rounded-xl border bg-slate-50 text-slate-900 outline-none transition-all ${
                          errors.newPassword
                            ? "border-red-300 focus:ring-2 focus:ring-red-200"
                            : "border-slate-200 focus:ring-2 focus:ring-[#1a56f0]/30 focus:border-[#1a56f0]"
                        }`}
                        autoComplete="new-password"
                      />
                      <EyeToggle
                        show={showNewPassword}
                        onToggle={() => setShowNewPassword(!showNewPassword)}
                      />
                    </div>
                    {errors.newPassword && (
                      <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1">
                        <svg
                          className="w-3 h-3"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <circle cx="12" cy="12" r="10" strokeWidth="2.5" />
                          <path d="M12 8v4m0 4h.01" strokeWidth="2.5" />
                        </svg>
                        {errors.newPassword}
                      </p>
                    )}

                    {/* Strength bar */}
                    {formData.newPassword && (
                      <div className="mt-2">
                        <div className="flex gap-1 mb-1">
                          {[1, 2, 3].map((i) => (
                            <div
                              key={i}
                              className={`h-1 flex-1 rounded-full transition-all ${
                                i <= strength.level
                                  ? strength.color
                                  : "bg-slate-200"
                              }`}
                            />
                          ))}
                        </div>
                        <p
                          className={`text-xs font-medium ${
                            strength.level === 1
                              ? "text-red-500"
                              : strength.level === 2
                                ? "text-amber-500"
                                : "text-emerald-500"
                          }`}
                        >
                          {strength.label}
                        </p>
                      </div>
                    )}

                    {/* Requirements */}
                    <div className="mt-2 space-y-1">
                      {[
                        {
                          met: formData.newPassword.length >= 8,
                          text: "At least 8 characters",
                        },
                        {
                          met: /[A-Z]/.test(formData.newPassword),
                          text: "One uppercase letter",
                        },
                        {
                          met: /[a-z]/.test(formData.newPassword),
                          text: "One lowercase letter",
                        },
                        {
                          met: /[0-9]/.test(formData.newPassword),
                          text: "One number",
                        },
                      ].map((req, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <svg
                            className={`w-3 h-3 ${req.met ? "text-emerald-500" : "text-slate-300"}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            {req.met ? (
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={3}
                                d="M5 13l4 4L19 7"
                              />
                            ) : (
                              <circle cx="12" cy="12" r="4" strokeWidth="3" />
                            )}
                          </svg>
                          <span
                            className={`text-xs ${req.met ? "text-emerald-600" : "text-slate-400"}`}
                          >
                            {req.text}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Confirm Password */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                      Confirm New Password
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
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
                            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                      </span>
                      <input
                        type={showConfirmPassword ? "text" : "password"}
                        value={formData.confirmPassword}
                        onChange={(e) => {
                          setFormData({
                            ...formData,
                            confirmPassword: e.target.value,
                          });
                          if (errors.confirmPassword)
                            setErrors((prev) => ({
                              ...prev,
                              confirmPassword: undefined,
                            }));
                        }}
                        placeholder="Repeat new password"
                        className={`w-full pl-10 pr-10 py-3 text-sm rounded-xl border bg-slate-50 text-slate-900 outline-none transition-all ${
                          errors.confirmPassword
                            ? "border-red-300 focus:ring-2 focus:ring-red-200"
                            : "border-slate-200 focus:ring-2 focus:ring-[#1a56f0]/30 focus:border-[#1a56f0]"
                        }`}
                        autoComplete="new-password"
                      />
                      <EyeToggle
                        show={showConfirmPassword}
                        onToggle={() =>
                          setShowConfirmPassword(!showConfirmPassword)
                        }
                      />
                    </div>
                    {errors.confirmPassword && (
                      <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1">
                        <svg
                          className="w-3 h-3"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <circle cx="12" cy="12" r="10" strokeWidth="2.5" />
                          <path d="M12 8v4m0 4h.01" strokeWidth="2.5" />
                        </svg>
                        {errors.confirmPassword}
                      </p>
                    )}
                    {/* Match indicator */}
                    {formData.confirmPassword && !errors.confirmPassword && (
                      <p className="text-xs mt-1.5 flex items-center gap-1">
                        {formData.newPassword === formData.confirmPassword ? (
                          <>
                            <svg
                              className="w-3 h-3 text-emerald-500"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={3}
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                            <span className="text-emerald-600">
                              Passwords match
                            </span>
                          </>
                        ) : (
                          <>
                            <svg
                              className="w-3 h-3 text-red-500"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={3}
                                d="M6 18L18 6M6 6l12 12"
                              />
                            </svg>
                            <span className="text-red-500">
                              Passwords do not match
                            </span>
                          </>
                        )}
                      </p>
                    )}
                  </div>

                  {/* Submit */}
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-[#1a56f0] hover:bg-[#1545d0] disabled:bg-slate-300 text-white font-semibold py-3 px-4 rounded-xl text-sm transition-colors flex items-center justify-center gap-2 mt-2"
                  >
                    {loading ? (
                      <>
                        <svg
                          className="animate-spin w-4 h-4"
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
                            d="M4 12a8 8 0 018-8v8z"
                          />
                        </svg>
                        Resetting...
                      </>
                    ) : (
                      <>
                        Reset Password
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
                            d="M5 12h14M12 5l7 7-7 7"
                          />
                        </svg>
                      </>
                    )}
                  </button>
                </form>
              </>
            ) : (
              /* Success */
              <div className="text-center py-4">
                <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg
                    className="w-8 h-8 text-emerald-500"
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
                </div>
                <h2 className="text-xl font-bold text-slate-900 mb-2">
                  Password reset!
                </h2>
                <p className="text-sm text-slate-500 mb-6">
                  Your password has been reset successfully. You can now sign in
                  with your new password.
                </p>
                <Link
                  href="/login"
                  className="inline-block w-full bg-[#1a56f0] hover:bg-[#1545d0] text-white font-semibold py-3 px-4 rounded-xl text-sm transition-colors text-center"
                >
                  Go to Login
                </Link>
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          © 2026 Innodata — Legal Regulatory Delivery Unit
        </p>
      </div>
    </div>
  );
}
