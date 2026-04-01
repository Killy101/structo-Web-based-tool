import type { Metadata } from "next";
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
    <html lang="en" className="dark">
      <body suppressHydrationWarning>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}