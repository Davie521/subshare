#!/usr/bin/env node
// Round 3 — fix raw Drizzle .get()/.all()/.run() on `db.` chains.
// Pattern is multiline: `const X = db\n  .select()\n  ...\n  .all()`
// Transform to: `const X = await db.select()...` (no .all())

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const TESTS_DIR = 'src/__tests__'
const files = readdirSync(TESTS_DIR).filter((f) => f.endsWith('.test.ts'))

let touched = 0

for (const file of files) {
  const abs = path.join(TESTS_DIR, file)
  const orig = readFileSync(abs, 'utf8')
  let out = orig

  // Find `const X = db` (or `= tx`) where X may be `[X]` destructuring.
  // Then walk forward to find the closing `.all()` `.get()` `.run()` tag
  // on that expression (at same or deeper indent). Replace.

  const lines = out.split('\n')
  const result = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const m = line.match(
      /^(\s*)(const\s+(?:\[[^\]]+\]|\w+)\s*=\s*|return\s+|^)\s*(db|tx)(\s|$)/
    )
    if (m && !line.includes('=>')) {
      const prefix = m[1]
      const assign = m[2] // "const X = " / "return " / ""
      const dbVar = m[3]
      // Find end line: look for one of `.get()`, `.all()`, `.run()`, `.values()`
      let end = i
      while (end < lines.length) {
        const lt = lines[end]
        if (/\.(get|all|run|values)\(\)\s*(?:$|[,;)\]])/.test(lt)) break
        end++
        if (end - i > 20) break
      }
      if (end < lines.length && end !== i && /\.(get|all|run|values)\(\)/.test(lines[end])) {
        const chained = lines.slice(i, end + 1).join('\n')
        const method = chained.match(/\.(get|all|run|values)\(\)/)
        if (method) {
          // Rewrite: strip the trailing method call, add `await` before `db`/`tx`.
          let rewritten = chained
            .replace(/\.(get|all|run|values)\(\)\s*$/m, '')
          // For `.get()` → destructure to `[X]`
          if (method[1] === 'get' && assign.startsWith('const ') && !assign.includes('[')) {
            rewritten = rewritten.replace(
              /const (\w+)\s*=/,
              'const [$1] ='
            )
          }
          // Add await before db/tx
          rewritten = rewritten.replace(
            new RegExp(`(${assign ? '=\\s*' : ''})(${dbVar})(\\s|$)`),
            `$1await $2$3`
          )
          // Avoid double-await
          rewritten = rewritten.replace(/await\s+await\s+/g, 'await ')
          result.push(rewritten)
          i = end + 1
          continue
        }
      }
    }
    result.push(line)
    i++
  }

  out = result.join('\n')

  // Also: trailing `.get()` / `.all()` / `.run()` on inline expressions
  // that we may have missed. Just strip them (they were our prior mistake).
  // Disabled — too risky without context.

  // --- Promote any non-async function that contains await ---
  // Re-scan and promote (round 2 logic, repeated).
  const promoteNames = new Set()
  const fnRe =
    /(?<!async )\bfunction\s+([A-Za-z_][\w]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{/g
  let fm
  while ((fm = fnRe.exec(out)) !== null) {
    const name = fm[1]
    const bodyStart = fm.index + fm[0].length - 1
    let depth = 0
    let j = bodyStart
    for (; j < out.length; j++) {
      const c = out[j]
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) break
      }
    }
    const body = out.slice(bodyStart, j + 1)
    if (/\bawait\b/.test(body)) promoteNames.add(name)
  }
  for (const name of promoteNames) {
    out = out.replace(
      new RegExp(String.raw`(?<!async\s)\bfunction\s+${name}\(`, 'g'),
      `async function ${name}(`
    )
    // Fix return type annotation `: number {` → `: Promise<number> {`
    out = out.replace(
      new RegExp(
        String.raw`async function ${name}\(([^)]*)\)\s*:\s*([^{]+?)\s*\{`,
        'g'
      ),
      (match, args, ret) => {
        if (ret.trim().startsWith('Promise<')) return match
        return `async function ${name}(${args}): Promise<${ret.trim()}> {`
      }
    )
    out = out.replace(
      new RegExp(
        String.raw`(?<![\w$])(?<!await )(?<!function )(?<!async function )${name}\(`,
        'g'
      ),
      `await ${name}(`
    )
  }

  // Cleanup double-await and broken imports
  out = out.replace(/\bawait\s+await\b/g, 'await')
  for (let k = 0; k < 4; k++) {
    out = out.replace(
      /(import \{[^}]*?)await ([A-Za-z_][\w]*)(\s*[,}])/g,
      '$1$2$3'
    )
  }

  if (out !== orig) {
    writeFileSync(abs, out)
    touched++
  }
}

console.log(`Round 3 touched: ${touched} / ${files.length}`)
