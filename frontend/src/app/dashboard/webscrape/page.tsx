"use client";
import dynamic from "next/dynamic";

const WebScrapeView = dynamic(
  () => import("../../../components/webscrape/WebScrapeView"),
  { ssr: false },
);

export default function WebScrapePage() {
  return <WebScrapeView />;
}
