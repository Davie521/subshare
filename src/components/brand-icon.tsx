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

  // Two reasons to render the chip instead of an <img>:
  //   1) the loaded image errored at runtime (`imgFailed`)
  //   2) the resolved entry is the letter fallback — a generic gray
  //      data-URL SVG can't be themed across modes, so we draw the chip
  //      directly with Tailwind classes that adapt to dark mode.
  // Branded chips (a real `icon.hex` from the manifest) use that hex
  // inline; the generic letter source picks a theme-aware zinc tone.
  const isLetterSource = icon.source === "letter";
  if (imgFailed || isLetterSource) {
    const useThemedChip = isLetterSource;
    return (
      <div
        className={`flex items-center justify-center rounded font-semibold text-white ${useThemedChip ? "bg-zinc-500 dark:bg-zinc-400" : ""} ${className ?? ""}`}
        style={{
          width: size,
          height: size,
          ...(useThemedChip ? {} : { backgroundColor: `#${icon.hex}` }),
          fontSize: size * 0.55,
        }}
      >
        {icon.letter}
      </div>
    );
  }

  // Simple Icons SVGs are monochrome black-on-transparent and disappear
  // on the dark surface. Invert only those — favicon PNGs are full
  // colour, and the letter source is handled above.
  const invertInDark = icon.source === "simple-icons";

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={icon.url}
      alt={name}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className={`rounded ${invertInDark ? "dark:invert" : ""} ${className ?? ""}`}
      style={{ width: size, height: size }}
      onError={() => setImgFailed(true)}
    />
  );
}
