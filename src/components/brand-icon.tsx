"use client";

import { useState } from "react";
import { findBrandIcon } from "@/lib/icons";

interface BrandIconProps {
  name: string;
  size?: number;
  className?: string;
}

export function BrandIcon({ name, size = 20, className }: BrandIconProps) {
  const icon = findBrandIcon(name);
  const [imgFailed, setImgFailed] = useState(false);

  if (imgFailed) {
    return (
      <div
        className={`flex items-center justify-center rounded font-semibold text-white ${className ?? ""}`}
        style={{
          width: size,
          height: size,
          backgroundColor: `#${icon.hex}`,
          fontSize: size * 0.55,
        }}
      >
        {icon.letter}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={icon.url}
      alt={name}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className={`rounded ${className ?? ""}`}
      style={{ width: size, height: size }}
      onError={() => setImgFailed(true)}
    />
  );
}
