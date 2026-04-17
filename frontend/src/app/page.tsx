"use client";

import Image from "next/image";
import styles from "./page.module.css";
import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import EyeTransition from "./login/Eyetransition";

/* ── Scroll-reveal hook ── */
function useScrollReveal() {
  useEffect(() => {
    const els = document.querySelectorAll("[data-reveal]");
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            const el = e.target as HTMLElement;
            const delay = el.dataset.delay ?? "0";
            el.style.transitionDelay = `${delay}ms`;
            el.classList.add(styles.revealed);
            io.unobserve(el);
          }
        });
      },
      { threshold: 0.12 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

/* ── Particle canvas background ── */
function ParticleCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = (canvas.width = window.innerWidth);
    let H = (canvas.height = window.innerHeight);

    const onResize = () => {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", onResize);

    const count = Math.min(Math.floor((W * H) / 14000), 80);
    const particles = Array.from({ length: count }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.4 + 0.3,
      vx: (Math.random() - 0.5) * 0.18,
      vy: (Math.random() - 0.5) * 0.18,
      opacity: Math.random() * 0.45 + 0.1,
    }));

    let raf: number;
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = W;
        if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H;
        if (p.y > H) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(66,180,245,${p.opacity})`;
        ctx.fill();
      });
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 110) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(26,143,209,${0.07 * (1 - dist / 110)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);
  return <canvas ref={ref} className={styles.particleCanvas} />;
}

export default function HomePage() {
  useScrollReveal();
  const router = useRouter();
  const [covered, setCovered] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-scroll-behavior", "smooth");
  }, []);
  const [showEye, setShowEye] = useState(false);
  const [lightMode, setLightMode] = useState(false);

  // No e.preventDefault needed — these are buttons, not anchor tags
  const goToLogin = useCallback(() => {
    setCovered(true); // black screen appears THIS frame
    setShowEye(true); // eye animation starts on top
  }, []);

  const handleEyeDone = useCallback(() => {
    router.push("/login");
  }, [router]);

  return (
    <>
      {/* Instant black cover — hides landing page the moment user clicks */}
      {covered && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "#040a14",
            zIndex: 9998,
            pointerEvents: "none",
          }}
        />
      )}

      {/* Eye transition plays on top of the black cover */}
      {showEye && <EyeTransition onComplete={handleEyeDone} />}

      <div className={`${styles.page} ${lightMode ? styles.lightMode : ""}`}>
        {/* Navigation */}
        <nav className={`${styles.nav} ${styles.navAnimate}`}>
          <div className={styles.navBrand}>
            <div className={styles.logoMark}>
              <Image
                src="/assets/innodata.png"
                alt="Innodata Logo"
                width={36}
                height={36}
                priority
              />
            </div>
            <div>
              <div className={styles.brandName}>Innodata</div>
              <div className={styles.brandSub}>Legal Regulatory Delivery Unit</div>
            </div>
          </div>
          <div className={styles.navLinks}>
            <a href="#" className={styles.navLink}>Home</a>
            <a href="#about" className={styles.navLink}>About Us</a>
            <a href="#features" className={styles.navLink}>Features</a>
          </div>
          <button
            onClick={() => setLightMode(v => !v)}
            className={styles.themeToggle}
            aria-label={lightMode ? "Switch to dark mode" : "Switch to light mode"}
            title={lightMode ? "Dark mode" : "Light mode"}
          >
            {lightMode ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
            )}
          </button>
          {/* button instead of <a> — no preventDefault needed */}
          <button onClick={goToLogin} className={styles.loginBtn}>
            Login
          </button>
        </nav>

        {/* Hero */}
        <div className={styles.heroWrapper}>
          <ParticleCanvas />
          <div className={styles.heroGrid} aria-hidden="true" />
          <div className={styles.orbBlue} aria-hidden="true" />
          <div className={styles.orbOrange} aria-hidden="true" />

          <section className={styles.hero}>
            <div className={styles.heroContent}>
              <div
                className={`${styles.heroBadge} ${styles.revealItem}`}
                data-reveal
                data-delay="0"
              >
                <span className={styles.badgePulse} />
                Powered by LRDU · Enterprise Grade
              </div>
              <h1
                className={`${styles.heroTitle} ${styles.revealItem}`}
                data-reveal
                data-delay="80"
              >
                <span className={styles.heroBrandSpan}>Structo</span>
                Intelligent Document Comparison, Change Detection &amp; Structuring
              </h1>
              <p
                className={`${styles.heroDesc} ${styles.revealItem}`}
                data-reveal
                data-delay="160"
              >
                The system provides an advanced web-based solution that compares
                document versions, detects content changes, validates structural
                elements, and generates structured outputs such as XML.
              </p>
              <div
                className={`${styles.heroCtas} ${styles.revealItem}`}
                data-reveal
                data-delay="240"
              >
                {/* button instead of <a> */}
                <button onClick={goToLogin} className={styles.ctaPrimary}>
                  Get Started
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </button>
                <a href="#features" className={styles.ctaSecondary}>
                  Learn More
                </a>
              </div>
            </div>

            <div
              className={`${styles.heroVisual} ${styles.revealItem}`}
              data-reveal
              data-delay="200"
            >
              <div className={styles.heroCard}>
                <div className={styles.cardHeader}>
                  <span className={styles.cardDot} style={{ background: "#ef4444" }} />
                  <span className={styles.cardDot} style={{ background: "#d4862e" }} />
                  <span className={styles.cardDot} style={{ background: "#10b981" }} />
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: "11px",
                      color: "#64748b",
                      fontFamily: "monospace",
                    }}
                  >
                    document_v2.xml
                  </span>
                </div>
                <div className={styles.cardBody}>
                  {[
                    { cls: styles.diffRemoved, delay: "0.3s",  text: '<section id="clause-4">' },
                    { cls: styles.diffAdded,   delay: "0.5s",  text: '<section id="clause-4" rev="2024">' },
                    { cls: "",                 delay: "0.65s", text: '  <title>Regulatory Compliance</title>' },
                    { cls: styles.diffRemoved, delay: "0.8s",  text: '  <status>pending</status>' },
                    { cls: styles.diffAdded,   delay: "0.95s", text: '  <status>approved</status>' },
                    { cls: "",                 delay: "1.1s",  text: '  <effective>2024-01-01</effective>' },
                    { cls: "",                 delay: "1.25s", text: "</section>" },
                  ].map((line, i) => (
                    <div
                      key={i}
                      className={`${styles.diffLine} ${line.cls} ${styles.diffLineAnim}`}
                      style={{ animationDelay: line.delay }}
                    >
                      {line.text}
                    </div>
                  ))}
                </div>
                <div className={styles.cardFooter}>
                  <span
                    className={styles.changeBadge}
                    style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444" }}
                  >
                    2 removed
                  </span>
                  <span
                    className={styles.changeBadge}
                    style={{ background: "rgba(16,185,129,0.12)", color: "#10b981" }}
                  >
                    2 added
                  </span>
                </div>
              </div>
              <div
                className={`${styles.floatingChip} ${styles.chipTop}`}
                style={{ top: "20px", right: "-20px" }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="2.5"
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                XML Validated
              </div>
              <div
                className={`${styles.floatingChip} ${styles.chipBottom}`}
                style={{ bottom: "40px", left: "-30px" }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#d4862e"
                  strokeWidth="2.5"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4l3 3" />
                </svg>
                Change Detected
              </div>
            </div>
          </section>
        </div>

        {/* Stats */}
        <section className={styles.statsSection}>
          <div className={styles.statsGrid}>
            {[
              { number: "10K+", label: "Documents Processed" },
              { number: "99.9%", label: "Structural Accuracy" },
              { number: "5+", label: "Supported Formats" },
              { number: "Real-time", label: "Change Detection" },
            ].map((stat, i) => (
              <div key={i} className={`${styles.statItem} ${styles.revealItem}`} data-reveal data-delay={`${i * 60}`}>
                <div className={styles.statNumber}>{stat.number}</div>
                <div className={styles.statLabel}>{stat.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* About Us */}
        <section className={styles.about} id="about">
          <div className={styles.aboutInner}>
            <div className={styles.aboutLayout}>
              <div className={styles.aboutLeft}>
                <div
                  className={`${styles.sectionLabel} ${styles.revealItem}`}
                  data-reveal
                  data-delay="0"
                >
                  About Us
                </div>
                <h2
                  className={`${styles.aboutHeading} ${styles.revealItem}`}
                  data-reveal
                  data-delay="80"
                >
                  Where document complexity meets
                  <br />
                  structured clarity.
                </h2>
                <div
                  className={`${styles.aboutAccent} ${styles.accentLine} ${styles.revealItem}`}
                  data-reveal
                  data-delay="160"
                />
                <p
                  className={`${styles.aboutText} ${styles.revealItem}`}
                  data-reveal
                  data-delay="200"
                >
                  At Innodata&apos;s Legal Regulatory Delivery Unit, we empower
                  organizations to manage complex documents with clarity, accuracy, and
                  speed. Through our platform{" "}
                  <strong style={{ color: "#e8963a" }}>Structo</strong>, we transform
                  traditional document workflows into intelligent, automated processes
                  that reduce manual effort and improve compliance confidence.
                </p>
              </div>
              <div className={styles.aboutDecorPanel}>
                <div className={styles.decorGrid}>
                  {[
                    {
                      dark: true,
                      delay: "0",
                      stroke: "#d4862e",
                      badge: "✓ Active",
                      badgeBlue: false,
                      label: ["Compliance", "Validated"],
                      path: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
                    },
                    {
                      dark: false,
                      delay: "80",
                      stroke: "#42b4f5",
                      badge: "100%",
                      badgeBlue: true,
                      label: ["INNOD.XML", "Structured"],
                      path: (
                        <>
                          <polyline points="16 18 22 12 16 6" />
                          <polyline points="8 6 2 12 8 18" />
                        </>
                      ),
                    },
                    {
                      dark: false,
                      delay: "120",
                      stroke: "#42b4f5",
                      badge: "Live",
                      badgeBlue: true,
                      label: ["Documents", "Compared"],
                      path: (
                        <>
                          <path d="M9 17H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                          <path d="M15 17h4a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4" />
                          <line x1="12" y1="3" x2="12" y2="21" />
                        </>
                      ),
                    },
                    {
                      dark: true,
                      delay: "200",
                      stroke: "#d4862e",
                      badge: "Real-time",
                      badgeBlue: false,
                      label: ["Changes", "Detected"],
                      path: (
                        <>
                          <circle cx="11" cy="11" r="8" />
                          <path d="M21 21l-4.35-4.35" />
                        </>
                      ),
                    },
                  ].map((c, i) => (
                    <div
                      key={i}
                      className={`${styles.decorCard} ${
                        c.dark ? styles.decorCardDark : styles.decorCardLight
                      } ${styles.revealItem}`}
                      data-reveal
                      data-delay={c.delay}
                    >
                      <svg
                        width="28"
                        height="28"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke={c.stroke}
                        strokeWidth="1.8"
                      >
                        {c.path}
                      </svg>
                      <span className={styles.decorCardLabel}>
                        {c.label[0]}
                        <br />
                        {c.label[1]}
                      </span>
                      <div
                        className={
                          c.badgeBlue
                            ? styles.decorCardBadgeBlue
                            : styles.decorCardBadge
                        }
                      >
                        {c.badge}
                      </div>
                    </div>
                  ))}
                </div>
                <div className={styles.decorOrb} />
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className={styles.features} id="features">
          <div className={styles.featuresInner}>
            <div
              className={`${styles.sectionLabel} ${styles.revealItem}`}
              data-reveal
              data-delay="0"
            >
              Core Capabilities
            </div>
            <h2
              className={`${styles.sectionTitle} ${styles.revealItem}`}
              data-reveal
              data-delay="60"
            >
              Everything you need for document intelligence
            </h2>
            <div className={styles.featureGrid}>
              {[
                {
                  title: "Document Comparison",
                  desc: "Side-by-side comparison of document versions with highlighted differences and change summaries.",
                  path: (
                    <>
                      <path d="M9 17H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <path d="M15 17h4a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4" />
                      <line x1="12" y1="3" x2="12" y2="21" />
                    </>
                  ),
                },
                {
                  title: "Change Detection",
                  desc: "Automatically identify and classify modifications, additions, and deletions across document revisions.",
                  path: (
                    <>
                      <circle cx="11" cy="11" r="8" />
                      <path d="M21 21l-4.35-4.35" />
                    </>
                  ),
                },
                {
                  title: "INNOD.XML Structuring",
                  desc: "Generate well-formed INNOD.XML outputs with validated structural elements from unstructured documents.",
                  path: (
                    <>
                      <polyline points="16 18 22 12 16 6" />
                      <polyline points="8 6 2 12 8 18" />
                    </>
                  ),
                },
                {
                  title: "Regulatory Compliance",
                  desc: "Built-in validation rules to ensure documents meet legal and regulatory standards.",
                  path: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
                },
              ].map((f, i) => (
                <div
                  key={i}
                  className={`${styles.featureCard} ${styles.revealItem}`}
                  data-reveal
                  data-delay={`${i * 80}`}
                >
                  <div className={styles.featureIcon}>
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      {f.path}
                    </svg>
                  </div>
                  <h3 className={styles.featureTitle}>{f.title}</h3>
                  <p className={styles.featureDesc}>{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Workflow Section */}
        <section className={styles.workflow} id="workflow">
          <div className={styles.workflowInner}>
            <div className={`${styles.sectionLabel} ${styles.revealItem}`} data-reveal data-delay="0">
              How It Works
            </div>
            <h2 className={`${styles.sectionTitle} ${styles.revealItem}`} data-reveal data-delay="60">
              From raw documents to structured output
            </h2>
            <div className={styles.workflowSteps}>
              {[
                {
                  step: "01",
                  title: "Upload Document",
                  desc: "Upload your PDF, Word, or XML source documents. Structo accepts multiple formats and extracts content intelligently.",
                  icon: (
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                  ),
                  color: "#1a8fd1",
                },
                {
                  step: "02",
                  title: "AI Comparison",
                  desc: "Our AI engine compares document versions, detects structural changes, additions, deletions, and generates a diff report.",
                  icon: (
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/><path d="M11 8v6m-3-3h6"/>
                    </svg>
                  ),
                  color: "#d4862e",
                },
                {
                  step: "03",
                  title: "Validate & Export",
                  desc: "Review detected changes, validate INNOD.XML structure, and export clean structured output ready for regulatory submission.",
                  icon: (
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/><path d="M9 12h6"/>
                    </svg>
                  ),
                  color: "#10b981",
                },
              ].map((s, i) => (
                <div key={i} className={`${styles.workflowStepWrap} ${styles.revealItem}`} data-reveal data-delay={`${i * 100}`}>
                  <div className={styles.workflowStep}>
                    <div className={styles.workflowStepNum} style={{ color: s.color, borderColor: `${s.color}30` }}>
                      {s.step}
                    </div>
                    <div className={styles.workflowIcon} style={{ background: `${s.color}18`, color: s.color, borderColor: `${s.color}28` }}>
                      {s.icon}
                    </div>
                    <h3 className={styles.workflowTitle}>{s.title}</h3>
                    <p className={styles.workflowDesc}>{s.desc}</p>
                  </div>
                  {i < 2 && <div className={styles.workflowArrow} aria-hidden="true">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(26,143,209,0.3)" strokeWidth="2" strokeLinecap="round">
                      <path d="M5 12h14M12 5l7 7-7 7"/>
                    </svg>
                  </div>}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Banner */}
        <section className={styles.ctaBanner}>
          <div className={styles.ctaBannerInner}>
            <h2
              className={`${styles.ctaBannerTitle} ${styles.revealItem}`}
              data-reveal
              data-delay="0"
            >
              Ready to streamline your document workflow?
            </h2>
            <p
              className={`${styles.ctaBannerDesc} ${styles.revealItem}`}
              data-reveal
              data-delay="80"
            >
              Join Structo and bring intelligence to your legal &amp; regulatory
              document workflows.
            </p>
            {/* button instead of <a> */}
            <button
              onClick={goToLogin}
              className={`${styles.ctaBannerBtn} ${styles.revealItem}`}
              data-reveal
              data-delay="160"
            >
              Login to Platform →
            </button>
          </div>
        </section>

        {/* Footer */}
        <footer className={styles.footer}>
          <div className={styles.footerInner}>
            <div className={styles.footerBrand}>
              <div className={styles.brandName} style={{ color: "white" }}>
                Structo
              </div>
              <div
                style={{ color: "#64748b", fontSize: "13px", marginTop: "4px" }}
              >
                Innodata · Legal Regulatory Delivery Unit
              </div>
            </div>
            <div style={{ color: "#475569", fontSize: "13px" }}>
              © 2026 Innodata. All rights reserved.
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}