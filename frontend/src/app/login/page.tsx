"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import styles from "./page.module.css";
import api from "@/app/lib/api";
import axios from "axios";

interface FormErrors {
  identifier?: string;
  password?: string;
  general?: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  function validate(): boolean {
    const newErrors: FormErrors = {};

    if (!identifier.trim()) {
      newErrors.identifier = "User ID or email is required";
    }

    if (!password) {
      newErrors.password = "Password is required";
    } else if (password.length < 6) {
      newErrors.password = "Password must be at least 6 characters";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setErrors({});

    try {
      const response = await api.post("/auth/login", {
        identifier: identifier.trim(),
        password,
      });
      const { token, mustChangePassword } = response.data;

      localStorage.setItem("token", token);

      if (mustChangePassword) {
        router.push("/change-password");
      } else {
        router.push("/dashboard");
      }
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        setErrors({
          general: error.response?.data?.error || "Invalid credentials",
        });
      } else {
        setErrors({ general: "Something went wrong" });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      {/* Left Panel */}
      <div className={styles.leftPanel}>
        <div className={styles.leftContent}>
          <Link href="/" className={styles.backLink}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back to Home
          </Link>

          <div className={styles.brandBlock}>
            <h1 className={styles.brandTitle}>STRUCTO</h1>
            <div className={styles.logoMark}>
              <svg width="48" height="48" viewBox="0 0 36 36" fill="none">
                <rect
                  width="36"
                  height="36"
                  rx="8"
                  fill="rgba(255,255,255,0.15)"
                />
                <rect x="10" y="10" width="4" height="4" fill="#42b4f5" />
                <rect x="16" y="10" width="4" height="4" fill="#42b4f5" />
                <rect x="22" y="10" width="4" height="4" fill="#42b4f5" />
                <rect x="10" y="16" width="4" height="4" fill="#42b4f5" />
                <rect x="16" y="16" width="4" height="4" fill="white" />
                <rect x="22" y="16" width="4" height="4" fill="#42b4f5" />
                <rect x="10" y="22" width="4" height="4" fill="#42b4f5" />
                <rect x="16" y="22" width="4" height="4" fill="#42b4f5" />
                <rect x="22" y="22" width="4" height="4" fill="#42b4f5" />
              </svg>
            </div>
            <h1 className={styles.brandTitle}>Structo</h1>
            <p className={styles.brandSubtitle}>
              Legal Regulatory Delivery Unit
            </p>
          </div>

          <div className={styles.featuresBlock}>
            {[
              { icon: "⚡", label: "Intelligent document comparison" },
              { icon: "🔍", label: "Automated change detection" },
              { icon: "📄", label: "Structured INNOD.XML generation" },
              { icon: "🛡️", label: "Regulatory compliance validation" },
            ].map((f, i) => (
              <div key={i} className={styles.featureRow}>
                <span className={styles.featureEmoji}>{f.icon}</span>
                <span className={styles.featureLabel}>{f.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right Panel - Login Form */}
      <div className={styles.rightPanel}>
        <div className={styles.formContainer}>
          <div className={styles.formHeader}>
            <h2 className={styles.formTitle}>Welcome back</h2>
            <p className={styles.formSubtitle}>
              Sign in to your STRUCTO account
            </p>
          </div>

          {errors.general && (
            <div className={styles.errorAlert}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4m0 4h.01" />
              </svg>
              {errors.general}
            </div>
          )}

          <form onSubmit={handleSubmit} className={styles.form} noValidate>
            <div className={styles.field}>
              <label htmlFor="identifier" className={styles.label}>
                User ID or Email
              </label>
              <div className={styles.inputWrapper}>
                <svg
                  className={styles.inputIcon}
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                <input
                  id="identifier"
                  type="text"
                  value={identifier}
                  onChange={(e) => {
                    setIdentifier(e.target.value);
                    if (errors.identifier)
                      setErrors((prev) => ({ ...prev, identifier: undefined }));
                  }}
                  placeholder="Employee ID or email address"
                  className={`${styles.input} ${errors.identifier ? styles.inputError : ""}`}
                  autoComplete="username"
                />
              </div>
              {errors.identifier && (
                <p className={styles.fieldError}>{errors.identifier}</p>
              )}
            </div>

            <div className={styles.field}>
              <label htmlFor="password" className={styles.label}>
                Password
              </label>
              <div className={styles.inputWrapper}>
                <svg
                  className={styles.inputIcon}
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (errors.password)
                      setErrors((prev) => ({ ...prev, password: undefined }));
                  }}
                  placeholder="••••••••"
                  className={`${styles.input} ${errors.password ? styles.inputError : ""}`}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className={styles.togglePassword}
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
              {errors.password && (
                <p className={styles.fieldError}>{errors.password}</p>
              )}
            </div>

            <button
              type="submit"
              className={styles.submitBtn}
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className={styles.spinner} />
                  Signing in...
                </>
              ) : (
                <>
                  Sign In{" "}
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </>
              )}
            </button>
          </form>
          <div className={styles.forgotPasswordSection}>
            <Link href="/forgot-password" className={styles.forgotPasswordLink}>
              Forgot password?
            </Link>
          </div>
          <p className={styles.footerNote}>
            © 2026 Innodata — Legal Regulatory Delivery Unit
          </p>
        </div>
      </div>
    </div>
  );
}
