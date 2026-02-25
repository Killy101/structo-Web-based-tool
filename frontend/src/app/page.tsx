"use client";

import Link from "next/link";
import Image from "next/image";
import styles from "./page.module.css";

export default function HomePage() {
  return (
    <div className={styles.page}>
      {/* Navigation */}
      <nav className={styles.nav}>
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
            <div className={styles.brandSub}>
              Legal Regulatory Delivery Unit
            </div>
          </div>
        </div>
        <div className={styles.navLinks}>
          <a href="#" className={styles.navLink}>
            Home
          </a>
          <a href="#about" className={styles.navLink}>
            About Us
          </a>
          <a href="#features" className={styles.navLink}>
            Features
          </a>
        </div>
        <Link href="/login" className={styles.loginBtn}>
          Login
        </Link>
      </nav>

      {/* Hero */}
      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <div className={styles.heroBadge}>
            Powered by AI · Enterprise Grade
          </div>
          <h1 className={styles.heroTitle}>
            Structo: A Web-Based Platform for Intelligent Document Comparison,
            Change Detection, and Structuring
          </h1>
          <p className={styles.heroDesc}>
            The system provides an advanced web-based solution that compares
            document versions, detects content changes, validates structural
            elements, and generates structured outputs such as XML.
          </p>
          <div className={styles.heroCtas}>
            <Link href="/login" className={styles.ctaPrimary}>
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
            </Link>
            <a href="#features" className={styles.ctaSecondary}>
              Learn More
            </a>
          </div>
        </div>

        <div className={styles.heroVisual}>
          <div className={styles.heroCard}>
            <div className={styles.cardHeader}>
              <span
                className={styles.cardDot}
                style={{ background: "#ef4444" }}
              />
              <span
                className={styles.cardDot}
                style={{ background: "#f59e0b" }}
              />
              <span
                className={styles.cardDot}
                style={{ background: "#10b981" }}
              />
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: "11px",
                  color: "#94a3b8",
                  fontFamily: "monospace",
                }}
              >
                document_v2.xml
              </span>
            </div>
            <div className={styles.cardBody}>
              <div className={styles.diffLine + " " + styles.diffRemoved}>
                &lt;section id=&quot;clause-4&quot;&gt;
              </div>
              <div className={styles.diffLine + " " + styles.diffAdded}>
                &lt;section id=&quot;clause-4&quot; rev=&quot;2024&quot;&gt;
              </div>
              <div className={styles.diffLine}>
                {" "}
                &lt;title&gt;Regulatory Compliance&lt;/title&gt;
              </div>
              <div className={styles.diffLine + " " + styles.diffRemoved}>
                {" "}
                &lt;status&gt;pending&lt;/status&gt;
              </div>
              <div className={styles.diffLine + " " + styles.diffAdded}>
                {" "}
                &lt;status&gt;approved&lt;/status&gt;
              </div>
              <div className={styles.diffLine}>
                {" "}
                &lt;effective&gt;2024-01-01&lt;/effective&gt;
              </div>
              <div className={styles.diffLine}>&lt;/section&gt;</div>
            </div>
            <div className={styles.cardFooter}>
              <span
                className={styles.changeBadge}
                style={{ background: "#fef2f2", color: "#ef4444" }}
              >
                2 removed
              </span>
              <span
                className={styles.changeBadge}
                style={{ background: "#f0fdf4", color: "#10b981" }}
              >
                2 added
              </span>
            </div>
          </div>
          <div
            className={styles.floatingChip}
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
            className={styles.floatingChip}
            style={{ bottom: "40px", left: "-30px" }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#42b4f5"
              strokeWidth="2.5"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4l3 3" />
            </svg>
            Change Detected
          </div>
        </div>
      </section>

      {/* About Us */}
      <section className={styles.about} id="about">
        <div className={styles.aboutInner}>
          <div className={styles.aboutLayout}>

            {/* Left: Text content */}
            <div className={styles.aboutLeft}>
              <div className={styles.sectionLabel}>About Us</div>
              <h2 className={styles.aboutHeading}>
                Where document complexity meets<br />structured clarity.
              </h2>
              <div className={styles.aboutAccent} />
              <p className={styles.aboutText}>
                At Innodata&apos;s Legal Regulatory Delivery Unit, we empower
                organizations to manage complex documents
                with clarity, accuracy, and speed. Through our platform{" "}
                <strong>Structo</strong>, we transform traditional document
                workflows into intelligent, automated processes that reduce
                manual effort and improve compliance confidence.
              </p>

            </div>

            {/* Right: Decorative panel */}
            <div className={styles.aboutDecorPanel}>
              <div className={styles.decorGrid}>
                <div className={`${styles.decorCard} ${styles.decorCardDark}`}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#42b4f5" strokeWidth="1.8">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                  </svg>
                  <span className={styles.decorCardLabel}>Compliance<br/>Validated</span>
                  <div className={styles.decorCardBadge}>✓ Active</div>
                </div>
                <div className={`${styles.decorCard} ${styles.decorCardLight}`}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#1e40af" strokeWidth="1.8">
                    <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
                  </svg>
                  <span className={styles.decorCardLabel}>INNOD.XML<br/>Structured</span>
                  <div className={styles.decorCardBadgeBlue}>100%</div>
                </div>
                <div className={`${styles.decorCard} ${styles.decorCardLight}`}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#1e40af" strokeWidth="1.8">
                    <path d="M9 17H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                    <path d="M15 17h4a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4"/>
                    <line x1="12" y1="3" x2="12" y2="21"/>
                  </svg>
                  <span className={styles.decorCardLabel}>Documents<br/>Compared</span>
                  <div className={styles.decorCardBadgeBlue}>Live</div>
                </div>
                <div className={`${styles.decorCard} ${styles.decorCardDark}`}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#42b4f5" strokeWidth="1.8">
                    <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                  </svg>
                  <span className={styles.decorCardLabel}>Changes<br/>Detected</span>
                  <div className={styles.decorCardBadge}>Real-time</div>
                </div>
              </div>
              <div className={styles.decorOrb} />
            </div>

          </div>
        </div>
      </section>

      {/* Features */}
      <section className={styles.features} id="features">
        <div className={styles.featuresInner}>
          <div className={styles.sectionLabel}>Core Capabilities</div>
          <h2 className={styles.sectionTitle}>
            Everything you need for document intelligence
          </h2>
          <div className={styles.featureGrid}>
            {[
              {
                icon: (
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <path d="M9 17H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <path d="M15 17h4a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4" />
                    <line x1="12" y1="3" x2="12" y2="21" />
                  </svg>
                ),
                title: "Document Comparison",
                desc: "Side-by-side comparison of document versions with highlighted differences and change summaries.",
              },
              {
                icon: (
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="M21 21l-4.35-4.35" />
                  </svg>
                ),
                title: "Change Detection",
                desc: "Automatically identify and classify modifications, additions, and deletions across document revisions.",
              },
              {
                icon: (
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                  </svg>
                ),
                title: "INNOD.XML Structuring",
                desc: "Generate well-formed INNOD.XML outputs with validated structural elements from unstructured documents.",
              },
              {
                icon: (
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                ),
                title: "Regulatory Compliance",
                desc: "Built-in validation rules to ensure documents meet legal and regulatory standards.",
              },
            ].map((f, i) => (
              <div key={i} className={styles.featureCard}>
                <div className={styles.featureIcon}>{f.icon}</div>
                <h3 className={styles.featureTitle}>{f.title}</h3>
                <p className={styles.featureDesc}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Banner */}
      <section className={styles.ctaBanner}>
        <div className={styles.ctaBannerInner}>
          <h2 className={styles.ctaBannerTitle}>
            Ready to streamline your document workflow?
          </h2>
          <p className={styles.ctaBannerDesc}>
            Join the Innodata platform and bring intelligence to your regulatory
            process.
          </p>
          <Link href="/login" className={styles.ctaBannerBtn}>
            Login to Platform →
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerBrand}>
            <div className={styles.brandName} style={{ color: "white" }}>
              Innodata
            </div>
            <div
              style={{ color: "#94a3b8", fontSize: "13px", marginTop: "4px" }}
            >
              Legal Regulatory Delivery Unit
            </div>
          </div>
          <div style={{ color: "#64748b", fontSize: "13px" }}>
            © 2026 Innodata. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}