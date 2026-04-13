"use client";

import { useEffect, useState, useMemo } from "react";

interface BrandIconProps {
  name: string;
  size?: number;
  className?: string;
}

interface IconData {
  svg: string | null;
  color: string;
  faviconUrl: string | null;
  letter: string;
}

const iconCache = new Map<string, IconData | null>();

export function BrandIcon({ name, size = 20, className }: BrandIconProps) {
  const key = useMemo(() => name.toLowerCase(), [name]);
  const cached = iconCache.get(key);
  const [icon, setIcon] = useState<IconData | null>(cached ?? null);
  const [loaded, setLoaded] = useState(iconCache.has(key));
  const [faviconFailed, setFaviconFailed] = useState(false);

  useEffect(() => {
    if (iconCache.has(key)) return;
    let cancelled = false;
    fetch(`/api/icons?name=${encodeURIComponent(name)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const result = data.icon ?? null;
        iconCache.set(key, result);
        setIcon(result);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        iconCache.set(key, null);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [key, name]);

  if (!loaded || !icon) {
    return (
      <div className={className} style={{ width: size, height: size }}>
        <div className="w-full h-full rounded bg-muted animate-pulse" />
      </div>
    );
  }

  // 1. Real Simple Icons SVG
  if (icon.svg) {
    return (
      <div
        className={className}
        style={{ width: size, height: size, color: icon.color }}
        dangerouslySetInnerHTML={{
          __html: icon.svg.replace(
            "<svg",
            `<svg width="${size}" height="${size}"`
          ),
        }}
      />
    );
  }

  // 2. Favicon from Google
  if (icon.faviconUrl && !faviconFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={icon.faviconUrl}
        alt={name}
        width={size}
        height={size}
        className={`rounded ${className ?? ""}`}
        style={{ width: size, height: size }}
        onError={() => setFaviconFailed(true)}
      />
    );
  }

  // 3. Letter fallback
  return (
    <div
      className={`flex items-center justify-center rounded font-semibold text-white ${className ?? ""}`}
      style={{
        width: size,
        height: size,
        backgroundColor: icon.color,
        fontSize: size * 0.55,
      }}
    >
      {icon.letter}
    </div>
  );
}
