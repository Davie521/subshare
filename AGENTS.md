<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Design System

All UI work **must** follow `DESIGN.md` in the project root. It is a Linear × Notion fusion system with:

- Dual-mode: light = warm-paper (Notion), dark = near-black precision (Linear)
- Single brand accent: indigo-violet `#5e6ad2` / `#7170ff`
- Inter Variable with `font-feature-settings: "cv01", "ss03"` (non-negotiable, set at root)
- Card radius `12px`, button radius `6px` (this 2-step ratio is the signature)
- Warm-neutral grays in light mode, white-opacity surfaces + luminance stacking in dark mode

Before writing any component, colour, typography, spacing, or shadow — consult `DESIGN.md` and match its tokens/rules. Run through the iteration checklist in §10 before declaring a UI task done.
