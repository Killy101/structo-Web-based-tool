"use client";

import { useState } from "react";
import Link from "next/link";
import api from "@/app/lib/api";
import axios from "axios";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    if (!email) {
      setError("Email address is required");
      return;
    }

    setLoading(true);

    try {
      await api.post("/auth/forgot-password", { email });
      setSuccess(true);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.error || "Something went wrong");
      } else {
        setError("Something went wrong");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 to-blue-50 px-4">
      <div className="w-full max-w-md">
        {/* Card */}
        <div className="bg-white rounded-2xl shadow-lg p-8">
          {/* Badge */}
          <div className="mb-6">
            <span className="text-xs font-semibold tracking-widest text-slate-400 border border-slate-200 rounded-full px-3 py-1 uppercase">
              Secure Access
            </span>
          </div>

          {!success ? (
            <>
              {/* Header */}
              <h1 className="text-3xl font-bold text-slate-900 mb-1">
                Forgot password?
              </h1>
              <div className="w-8 h-0.5 bg-blue-400 mb-3" />
              <p className="text-sm text-slate-500 mb-6">
                Enter your email and well send you a reset link.
              </p>

              {/* Error */}
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg">
                  {error}
                </div>
              )}

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold tracking-widest text-slate-500 uppercase mb-2">
                    Email Address
                  </label>
                  <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 gap-3">
                    <svg
                      className="w-4 h-4 text-slate-400 shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                      />
                    </svg>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setError("");
                      }}
                      placeholder="you@example.com"
                      required
                      className="bg-transparent flex-1 text-sm text-slate-700 outline-none placeholder:text-slate-400"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-slate-900 hover:bg-slate-700 disabled:bg-slate-400 text-white font-semibold py-3 px-4 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
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
                      Sending...
                    </>
                  ) : (
                    <>Send Reset Link →</>
                  )}
                </button>
              </form>
            </>
          ) : (
            /* Success State */
            <div className="text-center py-4">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-7 h-7 text-green-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-2">
                Check your inbox
              </h2>
              <p className="text-sm text-slate-500">
                If <span className="font-medium text-slate-700">{email}</span>{" "}
                is registered, youll receive a reset link shortly.
              </p>
            </div>
          )}

          {/* Back to login */}
          <div className="mt-6 text-center">
            <Link
              href="/login"
              className="text-sm text-slate-400 hover:text-slate-600 transition-colors"
            >
              ← Back to Sign In
            </Link>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-slate-400 mt-6">
          © 2026 Innodata — Legal Regulatory Delivery Unit
        </p>
      </div>
    </div>
  );
}
