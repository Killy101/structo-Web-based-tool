"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import styles from "./page.module.css";
import api from "@/app/lib/api";
import axios from "axios";

interface FormErrors {
  userId?: string;
  password?: string;
  general?: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showSignedOutToast, setShowSignedOutToast] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  // Lock body scroll on desktop (two-panel layout fills viewport); allow scroll on mobile
  useEffect(() => {
    if (window.innerWidth > 860) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const token = localStorage.getItem("token");
    if (token) {
      api
        .get("/auth/me")
        .then(() => {
          router.replace("/dashboard");
        })
        .catch(() => {
          localStorage.removeItem("token");
        });
    }
  }, [router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const showNotice = sessionStorage.getItem("signedOutNotice") === "1";
    if (!showNotice) return;
    sessionStorage.removeItem("signedOutNotice");
    setShowSignedOutToast(true);
    const t = window.setTimeout(() => setShowSignedOutToast(false), 3900);
    return () => window.clearTimeout(t);
  }, []);

  function validate(): boolean {
    const newErrors: FormErrors = {};
    const trimmedId = userId.trim();
    if (!trimmedId) {
      newErrors.userId = "User ID is required";
    } else if (!/^[a-zA-Z0-9]{3,6}$/.test(trimmedId)) {
      newErrors.userId = "User ID must be 3–6 alphanumeric characters";
    }
    if (!password) {
      newErrors.password = "Password is required";
    } else if (password.length < 15) {
      newErrors.password = "Password must be at least 15 characters";
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
        userId: userId.trim(),
        password,
      });
      const { token, user } = response.data;
      localStorage.setItem("token", token);
      sessionStorage.setItem("justLoggedIn", "1");
      if (user?.mustChangePassword) {
        sessionStorage.setItem("forcePasswordChangeNotice", "1");
        router.push("/change-password");
      } else {
        router.push("/dashboard");
      }
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        if (error.response) {
          setErrors({
            general: error.response.data?.error || "Invalid credentials",
          });
        } else if (error.request) {
          setErrors({
            general:
              "Unable to reach the server. Please check your connection and try again.",
          });
        } else {
          setErrors({ general: "Something went wrong" });
        }
      } else {
        setErrors({ general: "Something went wrong" });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
        {/* Signed out toast */}
        {showSignedOutToast && (
          <div className={styles.signOutToast} role="status" aria-live="polite">
            <span className={styles.toastIcon}>
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </span>
            <span className={styles.toastContent}>
              <span className={styles.toastLabel}>Session ended</span>
              <span className={styles.toastText}>
                You&apos;ve been signed out.
              </span>
            </span>
          </div>
        )}

        {/* Left Panel — brand showcase with background image */}
        <div className={styles.leftPanel}>
          <div className={styles.leftOverlay} />
          <div className={styles.leftContent}>
            <Link href="/" className={styles.backLink}>
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              Back to Home
            </Link>

            <div className={styles.brandBlock}>
              <h1 className={styles.brandTitle}>
                <span className={styles.brandO}>S</span>tructo
              </h1>
              <p className={styles.brandSubtitle}>
                Document Intelligence Platform
              </p>
            </div>

            <div className={styles.dividerLine} />

            <div className={styles.featuresBlock}>
              {[
                {
                  icon: (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                    </svg>
                  ),
                  label: "Intelligent document comparison",
                },
                {
                  icon: (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="11" cy="11" r="8" />
                      <path d="M21 21l-4.35-4.35" />
                    </svg>
                  ),
                  label: "Automated change detection",
                },
                {
                  icon: (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="16 18 22 12 16 6" />
                      <polyline points="8 6 2 12 8 18" />
                    </svg>
                  ),
                  label: "Structured INNOD.XML generation",
                },
              ].map(({ icon, label }, i) => (
                <div className={styles.featureRow} key={i}>
                  <span className={styles.featureIcon}>{icon}</span>
                  <span className={styles.featureLabel}>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Panel — login form */}
        <div className={styles.rightPanel}>
          <div className={styles.rightBg} />
          <div className={styles.formContainer}>
            <div className={styles.formHeader}>
              <span className={styles.secureLabel}>
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                Secure Access
              </span>
              <h2 className={styles.formTitle}>Welcome back!</h2>
              <div className={styles.accentBar} />
              <p className={styles.formSubtitle}>
                Sign in to your Structo account to continue.
              </p>
            </div>

            {errors.general && (
              <div className={styles.errorAlert} role="alert">
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ flexShrink: 0 }}
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4m0 4h.01" />
                </svg>
                {errors.general}
              </div>
            )}

            <form onSubmit={handleSubmit} className={styles.form} noValidate>
              <div className={styles.field}>
                <label htmlFor="userId" className={styles.label}>
                  User ID
                </label>
                <div
                  className={`${styles.inputWrapper} ${focusedField === "userId" ? styles.inputWrapperFocused : ""} ${errors.userId ? styles.inputWrapperError : ""}`}
                >
                  <span className={styles.inputIcon}>
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </span>
                  <input
                    id="userId"
                    type="text"
                    value={userId}
                    onChange={(e) => {
                      setUserId(e.target.value);
                      if (errors.userId)
                        setErrors((p) => ({ ...p, userId: undefined }));
                    }}
                    onFocus={() => setFocusedField("userId")}
                    onBlur={() => setFocusedField(null)}
                    placeholder="Enter your User ID"
                    className={styles.input}
                    autoComplete="username"
                  />
                </div>
                {errors.userId && (
                  <p className={styles.fieldError}>
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 8v4m0 4h.01" />
                    </svg>
                    {errors.userId}
                  </p>
                )}
              </div>

              <div className={styles.field}>
                <label htmlFor="password" className={styles.label}>
                  Password
                </label>
                <div
                  className={`${styles.inputWrapper} ${focusedField === "password" ? styles.inputWrapperFocused : ""} ${errors.password ? styles.inputWrapperError : ""}`}
                >
                  <span className={styles.inputIcon}>
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </span>
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (errors.password)
                        setErrors((p) => ({ ...p, password: undefined }));
                    }}
                    onFocus={() => setFocusedField("password")}
                    onBlur={() => setFocusedField(null)}
                    placeholder="••••••••"
                    className={styles.input}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className={styles.togglePassword}
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
                {errors.password && (
                  <p className={styles.fieldError}>
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 8v4m0 4h.01" />
                    </svg>
                    {errors.password}
                  </p>
                )}
              </div>

              <div className={styles.forgotRow}>
                <Link href="/forgot-password" className={styles.forgotLink}>
                  Forgot password?
                </Link>
              </div>

              <button
                type="submit"
                className={styles.submitBtn}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className={styles.spinner} />
                    Signing in…
                  </>
                ) : (
                  <>
                    Sign In
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </>
                )}
              </button>
            </form>

            <p className={styles.footerNote}>
              © 2026 Structo · Innodata Legal Regulatory Delivery Unit
            </p>
          </div>
        </div>
      </div>
  );
}