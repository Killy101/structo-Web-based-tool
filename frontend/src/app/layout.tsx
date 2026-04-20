import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { AuthProvider } from "../context/AuthContext"; // adjust path if needed

export const metadata: Metadata = {
  title: "Structo | Document Intelligence Platform",
  description:
    "A Web-Based Platform for Intelligent Document Comparison, Change Detection, and Structuring",
  icons: {
    icon: "/idaf-icon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#060d1a" />
      </head>
      <body suppressHydrationWarning>
        {/* Remove dark class before first paint when user has saved light preference */}
        <Script id="theme-init" strategy="beforeInteractive">{`
          try {
            if (localStorage.getItem('theme') === 'light') {
              document.documentElement.classList.remove('dark');
            }
          } catch(e) {}
        `}</Script>
        <Script id="scroll-behavior-fix" strategy="beforeInteractive">
          {`document.documentElement.setAttribute('data-scroll-behavior', 'smooth');`}
        </Script>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}