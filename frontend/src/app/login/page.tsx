// "use client";

// import { useState } from "react";
// import { useRouter } from "next/navigation";
// import api from "@/app/lib/api";

// export default function LoginPage() {
//   const router = useRouter();
//   const [email, setEmail] = useState("");
//   const [password, setPassword] = useState("");

//   const handleLogin = async () => {
//     try {
//       const response = await api.post("/auth/login", {
//         email,
//         password,
//       });

//       // assuming backend returns:
//       // { token: "jwt-token", user: {...} }

//       const { token } = response.data;

//       localStorage.setItem("token", token);

//       router.push("/dashboard");
//     } catch (error: any) {
//       console.log(error.response?.data);
//       alert("Invalid credentials");
//     }
//   };

//   return (
//     <div className="flex min-h-screen items-center justify-center bg-gray-100">
//       <div className="w-96 bg-white p-8 rounded-xl shadow-lg">
//         <h2 className="text-2xl font-bold mb-6 text-center">Login</h2>

//         <input
//           type="email"
//           placeholder="Email"
//           className="w-full mb-4 p-2 border rounded"
//           value={email}
//           onChange={(e) => setEmail(e.target.value)}
//         />

//         <input
//           type="password"
//           placeholder="Password"
//           className="w-full mb-4 p-2 border rounded"
//           value={password}
//           onChange={(e) => setPassword(e.target.value)}
//         />

//         <button
//           onClick={handleLogin}
//           className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
//         >
//           Login
//         </button>
//       </div>
//     </div>
//   );
// }

"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import styles from "./page.module.css";
import api from "@/app/lib/api";
import axios from "axios";

interface FormErrors {
  email?: string;
  password?: string;
  general?: string;
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  function validate(): boolean {
    const newErrors: FormErrors = {};

    if (!email) {
      newErrors.email = "Email is required";
    } else if (!validateEmail(email)) {
      newErrors.email = "Please enter a valid email address";
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
      const response = await api.post("/auth/login", { email, password });
      const { token } = response.data;
      localStorage.setItem("token", token);
      router.push("/dashboard");
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
              <label htmlFor="email" className={styles.label}>
                Email Address
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
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (errors.email)
                      setErrors((prev) => ({ ...prev, email: undefined }));
                  }}
                  placeholder="your@email.com"
                  className={`${styles.input} ${errors.email ? styles.inputError : ""}`}
                  autoComplete="email"
                />
              </div>
              {errors.email && (
                <p className={styles.fieldError}>{errors.email}</p>
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

          <p className={styles.footerNote}>
            © 2026 Innodata — Legal Regulatory Delivery Unit
          </p>
        </div>
      </div>
    </div>
  );
}
