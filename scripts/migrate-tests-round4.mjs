#!/usr/bin/env node
// Round 4 — targeted fix for arrow-shorthand bodies that contain await.
// Patterns:
//   (args) => (await X).y         →  async (args) => (await X).y
//   (args) => await X             →  async (args) => await X
//   () => await X                 →  async () => await X
// Also: `expect(() => await X).toThrow()` → `await expect(X).rejects.toThrow()`
// And: `(uid: number) =>\n  (await ...)` multi-line.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const TESTS_DIR = 'src/__tests__'
const files = readdirSync(TESTS_DIR).filter((f) => f.endsWith('.test.ts'))

let touched = 0

for (const file of files) {
  const abs = path.join(TESTS_DIR, file)
  const orig = readFileSync(abs, 'utf8')
  let out = orig

  // --- `() => await ...` / `(args) => await ...` with await in body ---
  // Single-line: arrow body starts with await (possibly in parens)
  out = out.replace(
    /(?<!async\s)(\([^)]*\))\s*=>\s*((?:\(\s*)?await\b)/g,
    'async $1 => $2'
  )
  // Single-letter param like `n =>` (unparenthesized) with await body
  out = out.replace(
    /(?<!async\s)(\b[a-zA-Z_][\w]*)\s*=>\s*((?:\(\s*)?await\b)/g,
    'async $1 => $2'
  )

  // Multi-line arrow shorthand: `(args) =>\n  (await ...)`
  out = out.replace(
    /(?<!async\s)(\([^)]*\))\s*=>\s*\n(\s*)((?:\(\s*)?await\b)/g,
    'async $1 =>\n$2$3'
  )

  // --- `expect(() => await FN).toThrow()` → `await expect(FN).rejects.toThrow()`
  // This is a common assertion pattern.
  out = out.replace(
    /expect\(\(\)\s*=>\s*async\s*\(\)\s*=>\s*\{/g,
    'expect(async () => {'
  )

  // Multi-line `expect(\n  () =>\n    await FN(...)\n  ).toThrow()` →
  // `await expect(\n    FN(...)\n  ).rejects.toThrow()`
  out = out.replace(
    /expect\(\s*\n\s*async\s*\(\)\s*=>\s*\n(\s*)await\s+([\s\S]*?)\n(\s*)\)\.toThrow\(\)/g,
    'await expect(\n$1$2\n$3).rejects.toThrow()'
  )

  // Cleanup double-async
  out = out.replace(/\basync\s+async\b/g, 'async')

  if (out !== orig) {
    writeFileSync(abs, out)
    touched++
  }
}

console.log(`Round 4 touched: ${touched} / ${files.length}`)
