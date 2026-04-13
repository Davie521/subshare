# SubShare Design System — Linear × Notion Fusion

> **Philosophy:** Linear's precision engineering on dark mode, Notion's warm approachability on light mode. Indigo-violet as the constant brand anchor across both.
>
> **When to use which mode:** Light mode is the default (friendly, consumer-facing — people are splitting bills with friends). Dark mode is first-class — it should feel like Linear, not like "light mode with black swapped in."

---

## 1. Visual Theme & Atmosphere

SubShare lives in two tonal worlds that share one brand. **Light mode** is Notion's warm-paper canvas — pure white surfaces with warm-neutral gray scales (yellow-brown undertones, never cold blue-gray), near-black text at `rgba(0,0,0,0.95)` instead of harsh `#000000`, and 1px whisper borders that divide without weight. The feeling is tactile and approachable, like a well-designed receipt book.

**Dark mode** is Linear's precision canvas — a near-black `#08090a` marketing background where content emerges via luminance stacking (`rgba(255,255,255,0.02)` → `0.04` → `0.05` surfaces), ultra-thin semi-transparent white borders, and display text compressed with aggressive negative letter-spacing. The feeling is engineered and deliberate, like the inside of a well-organized spreadsheet.

Typography is unified: **Inter Variable** with OpenType features `"cv01", "ss03"` enabled globally (Linear's geometric alternates). Weight range follows Notion's four-tier system (400 body / 500 UI / 600 emphasis / 700 display), but `510` is available for the Linear-precision feel on UI chrome in dark mode.

The single chromatic accent — **Linear indigo-violet `#5e6ad2` → `#7170ff`** — is the brand's anchor. It appears on both modes as the only saturated color in UI chrome; everything else is warm-neutral grayscale (light) or white-opacity grayscale (dark).

**Key Characteristics:**
- Dual-mode native: light = warm-paper (Notion), dark = near-black precision (Linear)
- Inter Variable with `"cv01", "ss03"` globally — non-negotiable
- Weight tiers: 400 (read) / 500 or 510 (UI) / 600 (emphasize) / 700 (display)
- Aggressive negative letter-spacing at display sizes (-1.5px at 48px, -2px at 64px)
- Brand indigo-violet `#5e6ad2` / `#7170ff` — the only chromatic color in chrome
- Light borders: `1px solid rgba(0,0,0,0.1)` (Notion whisper)
- Dark borders: `1px solid rgba(255,255,255,0.08)` (Linear subtle)
- Light shadows: 4–5 layer soft stacks (cumulative opacity ≤0.05)
- Dark "shadows": background luminance steps, not drop shadows
- Card radius 12px (Notion softness), button radius 6px (Linear precision)

---

## 2. Color Palette & Roles

### Brand (constant across modes)
| Role | Hex | CSS Variable |
|------|-----|--------------|
| Brand Indigo | `#5e6ad2` | `--brand` |
| Accent Violet | `#7170ff` | `--brand-accent` |
| Accent Hover | `#828fff` | `--brand-accent-hover` |
| Active Pressed | `#4a56c4` | `--brand-active` |

### Light Mode — Warm Paper (Notion)
| Role | Value | CSS Variable |
|------|-------|--------------|
| Background | `#ffffff` | `--bg` |
| Background Alt | `#f6f5f4` (warm white) | `--bg-alt` |
| Surface (card) | `#ffffff` | `--surface` |
| Surface Raised | `#fafaf9` | `--surface-raised` |
| Text Primary | `rgba(0,0,0,0.95)` | `--text` |
| Text Secondary | `#615d59` (warm gray 500) | `--text-muted` |
| Text Tertiary | `#a39e98` (warm gray 300) | `--text-subtle` |
| Border | `rgba(0,0,0,0.1)` | `--border` |
| Border Strong | `rgba(0,0,0,0.16)` | `--border-strong` |
| Badge Indigo Bg | `#eef0ff` | `--badge-brand-bg` |
| Badge Indigo Text | `#4a56c4` | `--badge-brand-fg` |

### Dark Mode — Precision Canvas (Linear)
| Role | Value | CSS Variable |
|------|-------|--------------|
| Background | `#08090a` | `--bg` |
| Background Alt | `#0f1011` (panel) | `--bg-alt` |
| Surface (card) | `rgba(255,255,255,0.02)` | `--surface` |
| Surface Raised | `rgba(255,255,255,0.04)` | `--surface-raised` |
| Surface Elevated | `rgba(255,255,255,0.05)` | `--surface-elevated` |
| Text Primary | `#f7f8f8` | `--text` |
| Text Secondary | `#d0d6e0` | `--text-muted` |
| Text Tertiary | `#8a8f98` | `--text-subtle` |
| Text Quaternary | `#62666d` | `--text-faint` |
| Border | `rgba(255,255,255,0.08)` | `--border` |
| Border Subtle | `rgba(255,255,255,0.05)` | `--border-subtle` |
| Badge Indigo Bg | `rgba(94,106,210,0.12)` | `--badge-brand-bg` |
| Badge Indigo Text | `#7170ff` | `--badge-brand-fg` |

### Semantic (works in both modes — use with `/light` and `/dark` pairs)
| Role | Light | Dark |
|------|-------|------|
| Success | `#1aae39` | `#10b981` |
| Warning | `#dd5b00` | `#f59e0b` |
| Danger | `#e5484d` | `#ef4444` |
| Info | `#0075de` | `#3b82f6` |

**Color Rules:**
- Indigo-violet is the **only saturated color in UI chrome**. Semantic colors appear only as status (badges, icons, inline indicators) — never as section backgrounds or CTA buttons.
- Light mode grays carry **warm undertones** (yellow-brown). Never use cool blue-gray like `#6b7280`.
- Dark mode surfaces are **never solid gray** (`#1a1a1a`). Always use `rgba(255,255,255,x)` over the dark canvas so the luminance-stacking illusion works.
- Text is never pure black or pure white: `rgba(0,0,0,0.95)` / `#f7f8f8`.

---

## 3. Typography Rules

### Font Stack
```css
--font-sans: "Inter Variable", "Inter", -apple-system, system-ui, "Segoe UI",
             "Roboto", "Helvetica Neue", sans-serif;
--font-mono: "Berkeley Mono", ui-monospace, "SF Mono", "Menlo", monospace;
font-feature-settings: "cv01", "ss03";  /* non-negotiable — global */
```

Enable `"lnum"` additionally on display text (≥32px) for consistent lining numerals — useful for subscription prices and dates.

### Hierarchy

| Role | Size | Weight | Line Height | Letter Spacing | Usage |
|------|------|--------|-------------|----------------|-------|
| Display XL | 72px | 700 | 1.00 | -2.016px | Landing hero only |
| Display | 56px | 700 | 1.02 | -1.68px | Marketing headlines |
| Display Small | 48px | 700 | 1.00 | -1.5px | Section headlines |
| H1 | 32px | 700 | 1.15 | -0.704px | Page titles |
| H2 | 24px | 600 | 1.30 | -0.288px | Section headings |
| H3 | 20px | 600 | 1.33 | -0.24px | Card titles, subsection |
| H4 | 17px | 600 | 1.50 | normal | Emphasized body |
| Body Large | 18px | 400 | 1.60 | -0.165px | Intro paragraphs |
| Body | 16px | 400 | 1.50 | normal | Default reading |
| Body Medium | 16px | 500 / 510 | 1.50 | normal | Nav links, labels |
| Small | 15px | 400 | 1.55 | -0.165px | Secondary text |
| Caption | 13–14px | 500 | 1.43 | normal | Metadata, timestamps |
| Badge | 12px | 600 | 1.33 | 0.125px | Pills, tags (positive tracking) |
| Micro | 11px | 510 | 1.40 | normal | Tiny UI labels |
| Code | 14px | 400 | 1.50 | normal | Inline code, tokens |

**Typography Principles:**
- **Letter-spacing scales with size**: aggressive negative at display (-2.0px at 72px), relaxes toward 16px (normal), then slight negative reappears at caption sizes for optical balance.
- **`510` is dark-mode UI's signature weight** — use it for navigation and labels in dark mode for the Linear-precision feel. In light mode, stay at `500` or `600` for the warmer Notion hierarchy.
- **Badges only have positive letter-spacing** (+0.125px at 12px) — improves small-text legibility and is the sole exception to the "always negative" rule.
- **Never use weight 800/900.** Maximum is 700 for display, 600 for UI emphasis.

---

## 4. Component Stylings

### Buttons

**Primary (Brand CTA)** — same shape, both modes
- Background: `#5e6ad2`
- Text: `#ffffff`
- Padding: `8px 16px`
- Radius: `6px`
- Hover: background → `#7170ff`
- Active: background → `#4a56c4`, `scale(0.98)`
- Focus: `2px solid rgba(94,106,210,0.4)` offset ring
- Font: 15px weight 600

**Secondary (Ghost)**
- Light: bg `rgba(0,0,0,0.04)`, text `rgba(0,0,0,0.95)`, border `1px solid rgba(0,0,0,0.1)`
- Dark: bg `rgba(255,255,255,0.02)`, text `#e2e4e7`, border `1px solid rgba(255,255,255,0.08)`
- Hover: background opacity +0.02
- Radius: `6px` / Padding: `8px 16px`

**Tertiary (Link Button)**
- Background: transparent
- Text: `#5e6ad2` (light) / `#7170ff` (dark)
- Hover: underline
- No padding, no border

**Icon Button (Circle)**
- Size: `32px × 32px`
- Radius: `50%`
- Light: bg `rgba(0,0,0,0.04)`, border `1px solid rgba(0,0,0,0.1)`
- Dark: bg `rgba(255,255,255,0.03)`, border `1px solid rgba(255,255,255,0.08)`

### Cards

**Standard Card** (the workhorse — use for subscription tiles, member cards, payment rows)
- Light: bg `#ffffff`, border `1px solid rgba(0,0,0,0.1)`, soft shadow stack
- Dark: bg `rgba(255,255,255,0.02)`, border `1px solid rgba(255,255,255,0.08)`, NO shadow
- Radius: `12px`
- Padding: `20px` (comfortable), `24px` (featured)
- Hover: light → shadow intensifies; dark → bg opacity → 0.04

**Featured / Hero Card**
- Radius: `16px`
- Padding: `32px`
- Light: subtle gradient overlay `linear-gradient(180deg, #ffffff 0%, #fafaf9 100%)`
- Dark: `rgba(255,255,255,0.04)` bg with inset highlight `inset 0 1px 0 rgba(255,255,255,0.05)`

### Inputs

- Radius: `6px` (matches buttons — a Linear choice)
- Padding: `10px 14px`
- Font: 15px weight 400
- Light: bg `#ffffff`, border `1px solid rgba(0,0,0,0.16)`
- Dark: bg `rgba(255,255,255,0.02)`, border `1px solid rgba(255,255,255,0.08)`
- Focus: `2px solid #5e6ad2` (offset via `box-shadow: 0 0 0 2px rgba(94,106,210,0.3)`)
- Placeholder: `#a39e98` (light) / `#62666d` (dark)

### Badges & Pills

**Brand Pill** (the distinctive SubShare tag — e.g., "Shared", "Active", "Netflix")
- Radius: `9999px`
- Padding: `4px 10px`
- Font: 12px weight 600, letter-spacing +0.125px
- Light: bg `#eef0ff`, text `#4a56c4`
- Dark: bg `rgba(94,106,210,0.12)`, text `#7170ff`

**Status Dot Pill**
- Radius: `9999px`
- Padding: `2px 8px 2px 6px`
- Prefix with a 6px circle in the semantic color (success/warning/danger)
- Text color follows semantic pair

**Ghost Pill** (filter chips)
- Radius: `9999px`
- Border: `1px solid var(--border)`
- Background: transparent
- Padding: `4px 10px`

### Navigation
- Height: `60px`
- Light: `#ffffff` bg, `1px solid rgba(0,0,0,0.1)` bottom border
- Dark: `#0f1011` bg, `1px solid rgba(255,255,255,0.05)` bottom border
- Logo left, nav links center/left, CTA + avatar right
- Links: 15px weight 500 (light) / 510 (dark), `var(--text-muted)` → `var(--text)` on hover
- Mobile: hamburger at `<768px`, slide-in drawer

### Modal / Dialog
- Backdrop: `rgba(0,0,0,0.5)` (light) / `rgba(0,0,0,0.85)` (dark — Linear's overlay)
- Panel radius: `16px`
- Panel padding: `32px`
- Light: white bg + deep 5-layer shadow stack
- Dark: `#191a1b` bg + `1px solid rgba(255,255,255,0.08)` + subtle inset highlight

### Table (for subscription lists, payment history)
- Row height: `52px`
- Divider: `1px solid var(--border-subtle)` between rows, no divider on hover row
- Hover: light bg `#fafaf9`, dark bg `rgba(255,255,255,0.02)`
- Header: 13px weight 600, `var(--text-muted)`, uppercase optional, +0.5px tracking

---

## 5. Layout Principles

### Spacing System (8px base)
| Token | Value |
|-------|-------|
| `--space-1` | `4px` |
| `--space-2` | `8px` |
| `--space-3` | `12px` |
| `--space-4` | `16px` |
| `--space-5` | `20px` |
| `--space-6` | `24px` |
| `--space-8` | `32px` |
| `--space-10` | `40px` |
| `--space-12` | `48px` |
| `--space-16` | `64px` |
| `--space-20` | `80px` |
| `--space-24` | `96px` |

Marketing sections: `80px+` vertical padding. App chrome: `16–24px` padding. Card internals: `20–24px`.

### Grid & Container
- App max width: `1280px`
- Marketing max width: `1200px`
- Content column (article/reading): `720px`
- Gutter: `24px` on desktop, `16px` on mobile

### Radius Scale
| Token | Value | Use |
|-------|-------|-----|
| `--r-sm` | `4px` | Inline code, tiny tags |
| `--r-md` | `6px` | Buttons, inputs, toolbar items |
| `--r-lg` | `8px` | Small cards, list items |
| `--r-xl` | `12px` | Standard cards |
| `--r-2xl` | `16px` | Featured cards, modals |
| `--r-3xl` | `22px` | Hero panels |
| `--r-full` | `9999px` | Pills, badges |
| `--r-circle` | `50%` | Avatars, icon buttons |

### Section Alternation (marketing pages only)
Alternate `#ffffff` with `#f6f5f4` (warm white) in light mode. In dark mode, alternate `#08090a` with `#0f1011`. No hard borders between sections — the background shift + 80px+ padding does the work.

---

## 6. Depth & Elevation

### Light Mode (Notion — soft shadow stacks)
| Level | Shadow |
|-------|--------|
| L0 Flat | none |
| L1 Whisper | `1px solid rgba(0,0,0,0.1)` (border acts as depth) |
| L2 Card | `0 4px 18px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.027), 0 1px 3px rgba(0,0,0,0.02), 0 0.5px 1px rgba(0,0,0,0.01)` |
| L3 Popover | `0 8px 24px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04), 0 2px 6px rgba(0,0,0,0.02)` |
| L4 Modal | `0 24px 52px rgba(0,0,0,0.05), 0 14px 28px rgba(0,0,0,0.04), 0 7px 15px rgba(0,0,0,0.02), 0 3px 7px rgba(0,0,0,0.02), 0 1px 3px rgba(0,0,0,0.01)` |

### Dark Mode (Linear — luminance stacking)
| Level | Technique |
|-------|-----------|
| L0 Flat | bg `#08090a` |
| L1 Panel | bg `#0f1011` |
| L2 Surface | bg `rgba(255,255,255,0.02)` + border `rgba(255,255,255,0.08)` |
| L3 Raised | bg `rgba(255,255,255,0.04)` + border `rgba(255,255,255,0.08)` |
| L4 Elevated | bg `rgba(255,255,255,0.05)` + border `rgba(255,255,255,0.08)` + inset highlight `inset 0 1px 0 rgba(255,255,255,0.05)` |
| L5 Dialog | bg `#191a1b` + multi-layer subtle shadow + ring `0 0 0 1px rgba(0,0,0,0.2)` |

**Philosophy:** On light, elevation is **light casting downward** (soft shadows). On dark, elevation is **luminance stepping upward** (brighter = closer). Never port light-mode drop shadows into dark mode — they read as noise.

---

## 7. Do's and Don'ts

### Do
- Enable `font-feature-settings: "cv01", "ss03"` on the root — non-negotiable
- Use `#5e6ad2` indigo for **every** primary CTA across both modes
- Keep card radius at `12px` and button radius at `6px` — this 2-step ratio is the fusion signature
- Use warm-neutral grays in light mode (`#615d59`, `#a39e98`)
- Apply aggressive negative letter-spacing on all display text (`-1.5px+` at 48px+)
- Use pill badges (9999px) for status, category, and subscription-service tags
- Alternate white / warm-white sections on marketing pages for gentle rhythm
- In dark mode, use luminance stacking (opacity steps) instead of shadows

### Don't
- Don't use pure `#000000` or pure `#ffffff` text — always `rgba(0,0,0,0.95)` / `#f7f8f8`
- Don't use cold blue-gray (`#6b7280`, `#9ca3af`) — it breaks the warm-neutral system
- Don't apply drop shadows in dark mode — use background opacity stepping
- Don't introduce secondary brand colors — indigo is the only chromatic accent in chrome
- Don't use weight 700 on UI chrome (nav, buttons, labels) — it's display-only
- Don't use solid colored backgrounds on dark-mode buttons — use `rgba(255,255,255,0.02–0.05)`
- Don't skip the OpenType features — without `cv01`/`ss03` this is generic Inter, not the fusion look
- Don't use positive letter-spacing except on 12px badges (+0.125px)
- Don't mix the two modes' shadow philosophies (no luminance stacking in light, no drop shadows in dark)

---

## 8. Responsive Behavior

### Breakpoints
| Name | Width |
|------|-------|
| Mobile | `<640px` |
| Tablet | `640–1024px` |
| Desktop | `1024–1280px` |
| Large | `>1280px` |

### Collapse Strategy
- Display XL (72px) → 48px → 36px on mobile, letter-spacing scales proportionally
- 3-col card grid → 2-col @ tablet → 1-col @ mobile
- Section padding: `80px+` → `48px` on mobile
- Nav: horizontal links → hamburger drawer below `768px`
- Tables: horizontal scroll on mobile, or collapse to card layout for key views
- Modal: full-screen sheet on mobile, centered dialog on desktop

### Touch Targets
- Minimum interactive height: `44px`
- Button padding: `8px 16px` = comfortable tap with 15px text
- Icon buttons: `32–40px` circles

---

## 9. Accessibility

- **Focus ring**: `2px solid #5e6ad2` with `box-shadow: 0 0 0 4px rgba(94,106,210,0.2)` offset — visible on both modes
- **Contrast ratios**: primary text on bg hits AAA on both modes (>14:1 light, >15:1 dark)
- **Color is not the only signal**: status always pairs color with icon + text
- **Keyboard**: all interactive components reachable via Tab, with visible focus
- **Mode toggle**: respect `prefers-color-scheme` by default, allow manual override via `data-theme` attribute on `<html>`

---

## 10. Agent Prompt Guide

### Quick Color Reference
| Role | Light | Dark |
|------|-------|------|
| Primary CTA | `#5e6ad2` bg, `#fff` text | `#5e6ad2` bg, `#fff` text |
| Background | `#ffffff` | `#08090a` |
| Alt Background | `#f6f5f4` | `#0f1011` |
| Text | `rgba(0,0,0,0.95)` | `#f7f8f8` |
| Muted Text | `#615d59` | `#8a8f98` |
| Border | `rgba(0,0,0,0.1)` | `rgba(255,255,255,0.08)` |
| Brand Badge Bg | `#eef0ff` | `rgba(94,106,210,0.12)` |

### Example Prompts
- **"Build a subscription tile card."** On light: `#ffffff` bg, `12px` radius, `1px solid rgba(0,0,0,0.1)` border, 4-layer soft shadow. On dark: `rgba(255,255,255,0.02)` bg, same border swapped to `rgba(255,255,255,0.08)`, no shadow. Title `20px weight 600`, price `17px weight 600`, members `13px weight 500 #615d59/#8a8f98`. Brand pill "Active" in `#eef0ff/#4a56c4` (light) or `rgba(94,106,210,0.12)/#7170ff` (dark), radius 9999px, 12px weight 600 letter-spacing +0.125px.
- **"Build the hero."** Headline `56px Inter weight 700 letter-spacing -1.68px`, color `var(--text)`. Subtitle `18px weight 400 line-height 1.6 color var(--text-muted)`. Primary indigo CTA + ghost secondary button. Section vertical padding 96–120px. Use `"cv01","ss03"` on root.
- **"Build the payment history table."** Row height 52px, 13px weight 600 `var(--text-muted)` header, dividers `1px solid var(--border-subtle)`, hover row bg `#fafaf9` / `rgba(255,255,255,0.02)`.
- **"Build a status pill."** 9999px radius, `4px 10px` padding, `12px weight 600 letter-spacing +0.125px`. Pair semantic color (success/warning/danger) background tint with matching text.

### Iteration Checklist
1. Is `font-feature-settings: "cv01", "ss03"` set on root? ✓
2. Are all CTAs using `#5e6ad2`? ✓
3. Do display headlines have aggressive negative letter-spacing (`≤-1.5px` at 48px+)? ✓
4. Are grays warm-neutral (light) or white-opacity (dark), never cold blue-gray? ✓
5. Card radius `12px`, button radius `6px`? ✓
6. In dark mode: luminance stacking, no drop shadows? ✓
7. In light mode: 4-layer soft shadow stacks, warm-white section alternation? ✓
8. Is indigo the only chromatic color in chrome (semantic colors only for status)? ✓
