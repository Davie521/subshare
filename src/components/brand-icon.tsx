"use client";

import { useEffect, useState, useMemo } from "react";
import { CreditCard } from "lucide-react";

interface BrandIconProps {
  name: string;
  size?: number;
  className?: string;
}

interface IconData {
  title: string;
  svg: string;
  color: string;
}

// Client-side cache to avoid repeated fetches
const iconCache = new Map<string, IconData | null>();

export function BrandIcon({ name, size = 20, className }: BrandIconProps) {
  const key = useMemo(() => name.toLowerCase(), [name]);
  const cached = iconCache.get(key);
  const [icon, setIcon] = useState<IconData | null>(cached ?? null);
  const [loaded, setLoaded] = useState(iconCache.has(key));

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

  if (!loaded) {
    return (
      <div className={className} style={{ width: size, height: size }}>
        <div className="w-full h-full rounded bg-muted animate-pulse" />
      </div>
    );
  }

  if (!icon) {
    return (
      <div
        className={`flex items-center justify-center rounded bg-muted ${className ?? ""}`}
        style={{ width: size, height: size }}
      >
        <CreditCard className="w-3 h-3 text-muted-foreground" />
      </div>
    );
  }

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
