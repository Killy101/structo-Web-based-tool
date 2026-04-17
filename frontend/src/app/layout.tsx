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
    <html lang="en" className="dark" data-scroll-behavior="smooth">
      <body suppressHydrationWarning>
        <Script id="scroll-behavior-fix" strategy="beforeInteractive">
          {`document.documentElement.setAttribute('data-scroll-behavior', 'smooth');`}
        </Script>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}