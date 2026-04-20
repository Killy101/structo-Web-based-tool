"use client";

import { useMemo, type SyntheticEvent } from "react";

type BrdImageProps = {
  src: string;
  alt: string;
  className?: string;
  width?: number;
  height?: number;
  sizes?: string;
  loading?: "eager" | "lazy";
  onError?: (event: SyntheticEvent<HTMLImageElement, Event>) => void;
};

export default function BrdImage({
  src,
  alt,
  className,
  width = 1200,
  height = 800,
  sizes = "100vw",
  loading = "lazy",
  onError,
}: BrdImageProps) {
  const resolvedSrc = useMemo(() => {
    if (!src || typeof window === "undefined") return src;
    if (!/\/brd\/.*\/images\/.*\/blob(?:\?|$)/.test(src) || /[?&]token=/.test(src)) return src;

    const token = window.localStorage.getItem("token");
    if (!token) return src;

    return `${src}${src.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
  }, [src]);

  if (!resolvedSrc) return null;

  const resolvedClassName = [
    "block max-w-full h-auto max-h-32 object-contain",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={resolvedSrc}
      alt={alt}
      width={width}
      height={height}
      sizes={sizes}
      loading={loading}
      decoding="async"
      className={resolvedClassName}
      onLoad={(event) => {
        event.currentTarget.style.display = "";
      }}
      onError={onError}
    />
  );
}
