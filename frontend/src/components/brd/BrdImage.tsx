"use client";

import type { SyntheticEvent } from "react";

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
  if (!src) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      sizes={sizes}
      loading={loading}
      decoding="async"
      className={className}
      onError={onError}
    />
  );
}
