"use client";

import Image from "next/image";
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
  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      sizes={sizes}
      loading={loading}
      unoptimized
      className={className}
      onError={onError}
    />
  );
}
