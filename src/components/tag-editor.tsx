"use client";

import {
  useState,
  forwardRef,
  useImperativeHandle,
  useRef,
  useEffect,
} from "react";
import { Lock, Globe, X, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { SubscriptionTag } from "@/lib/api-client";

const MAX_TAGS = 5;
const MAX_LABEL = 10;

export interface TagEditorHandle {
  /**
   * Commit whatever is currently typed in the input row as a new tag,
   * bypassing the need to click Add first. Parents should call this
   * right before persisting (Save / Submit) so a user who typed a tag
   * and clicked Save without pressing Add doesn't lose the text.
   *
   * Returns the post-commit tag list if a commit actually happened, or
   * `null` when the input was empty / duplicate / disabled / at cap.
   * Callers should use the returned array for persistence because
   * React state updates scheduled from onChange won't be visible in the
   * same synchronous click handler.
   */
  commitPending: () => SubscriptionTag[] | null;
}

/**
 * Tag editor — list existing tags as chips (removable), an input row to
 * add new ones with a visibility toggle (public / private). Caps at
 * MAX_TAGS; de-dupes on label (case-insensitive).
 *
 * Controlled: parent owns `tags` state and receives `onChange` updates.
 */
export const TagEditor = forwardRef<
  TagEditorHandle,
  {
    tags: SubscriptionTag[];
    onChange: (next: SubscriptionTag[]) => void;
    disabled?: boolean;
  }
>(function TagEditor({ tags, onChange, disabled = false }, ref) {
  const [draftLabel, setDraftLabel] = useState("");
  const [draftVisibility, setDraftVisibility] = useState<"public" | "private">(
    "private"
  );
  // Refs mirroring props/state so imperative commitPending() can see the
  // latest values without waiting for a re-render. Sync via useEffect
  // rather than during render (React rule: refs aren't for render deps).
  // This adds a one-tick lag, but commitPending is called from click
  // handlers which fire after paint, so the refs are always fresh then.
  const tagsRef = useRef(tags);
  const draftLabelRef = useRef(draftLabel);
  const draftVisibilityRef = useRef(draftVisibility);
  const disabledRef = useRef(disabled);
  useEffect(() => {
    tagsRef.current = tags;
  }, [tags]);
  useEffect(() => {
    draftLabelRef.current = draftLabel;
  }, [draftLabel]);
  useEffect(() => {
    draftVisibilityRef.current = draftVisibility;
  }, [draftVisibility]);
  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  const atCap = tags.length >= MAX_TAGS;
  const trimmed = draftLabel.trim();
  const isDup = tags.some(
    (t) => t.label.toLowerCase() === trimmed.toLowerCase()
  );
  const canAdd =
    !disabled && !atCap && trimmed.length > 0 && trimmed.length <= MAX_LABEL && !isDup;

  function handleAdd() {
    if (!canAdd) return;
    onChange([...tags, { label: trimmed, visibility: draftVisibility }]);
    setDraftLabel("");
  }

  function removeAt(idx: number) {
    onChange(tags.filter((_, i) => i !== idx));
  }

  function toggleVisibility(idx: number) {
    onChange(
      tags.map((t, i) =>
        i === idx
          ? {
              ...t,
              visibility: t.visibility === "public" ? "private" : "public",
            }
          : t
      )
    );
  }

  useImperativeHandle(
    ref,
    () => ({
      commitPending() {
        if (disabledRef.current) return null;
        const label = draftLabelRef.current.trim();
        if (label.length === 0 || label.length > MAX_LABEL) return null;
        const current = tagsRef.current;
        if (current.length >= MAX_TAGS) return null;
        const dup = current.some(
          (t) => t.label.toLowerCase() === label.toLowerCase()
        );
        if (dup) return null;
        const next: SubscriptionTag[] = [
          ...current,
          { label, visibility: draftVisibilityRef.current },
        ];
        onChange(next);
        setDraftLabel("");
        return next;
      },
    }),
    [onChange]
  );

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <Label>Tags</Label>
        <span className="text-[11px] text-muted-foreground">
          {tags.length}/{MAX_TAGS}
        </span>
      </div>
      <p className="text-[12px] text-muted-foreground leading-relaxed">
        Short labels (up to {MAX_LABEL} chars). Private tags are only visible
        to the owner and payer. Press Enter or click Add to add.
      </p>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t, i) => (
            <span
              key={`${t.label}-${i}`}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium",
                t.visibility === "private"
                  ? "border-border bg-muted/60 text-muted-foreground"
                  : "border-transparent bg-accent text-accent-foreground"
              )}
            >
              <button
                type="button"
                onClick={() => toggleVisibility(i)}
                disabled={disabled}
                className="cursor-pointer"
                aria-label={`Toggle visibility for ${t.label}`}
                title={
                  t.visibility === "private"
                    ? "Private — only the owner and payer see this. Click to make public."
                    : "Public — all members see this. Click to make private."
                }
              >
                {t.visibility === "private" ? (
                  <Lock className="h-3 w-3" />
                ) : (
                  <Globe className="h-3 w-3" />
                )}
              </button>
              <span>{t.label}</span>
              <button
                type="button"
                onClick={() => removeAt(i)}
                disabled={disabled}
                className="cursor-pointer -mr-0.5 rounded hover:bg-foreground/10"
                aria-label={`Remove ${t.label}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {!atCap && (
        <div className="flex items-stretch gap-2">
          <Input
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value.slice(0, MAX_LABEL))}
            placeholder="e.g. Visa 1234"
            maxLength={MAX_LABEL}
            disabled={disabled}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAdd();
              }
            }}
            className="flex-1"
          />
          <button
            type="button"
            onClick={() =>
              setDraftVisibility((v) => (v === "public" ? "private" : "public"))
            }
            disabled={disabled}
            className={cn(
              "cursor-pointer flex items-center gap-1 rounded-md border px-2.5 text-[12px] font-medium transition-colors",
              draftVisibility === "private"
                ? "border-border bg-muted/60 text-muted-foreground"
                : "border-transparent bg-accent text-accent-foreground"
            )}
            aria-label="Toggle tag visibility"
            title={
              draftVisibility === "private"
                ? "Private — only the owner and payer see it"
                : "Public — everyone sees it"
            }
          >
            {draftVisibility === "private" ? (
              <>
                <Lock className="h-3 w-3" />
                Private
              </>
            ) : (
              <>
                <Globe className="h-3 w-3" />
                Public
              </>
            )}
          </button>
          <Button
            type="button"
            variant="outline"
            onClick={handleAdd}
            disabled={!canAdd}
            className="cursor-pointer gap-1.5"
            aria-label="Add tag"
          >
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
      )}
      {isDup && trimmed.length > 0 && (
        <p className="text-[12px] text-destructive">Tag already exists.</p>
      )}
    </div>
  );
});
