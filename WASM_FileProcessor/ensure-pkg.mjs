// Guarantees WASM_FileProcessor/pkg/ always contains something importable, so `npm run check`
// and `npm run build` succeed even on a machine without the Rust toolchain. `pkg/` itself is
// gitignored (it's wasm-pack's build output); when the real build hasn't been run, this copies
// in the hand-written fallback from pkg-fallback/ (tracked in git) instead.
//
// Used both as a standalone `precheck` step and imported by vite.config.mjs.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgDir = path.join(here, 'pkg')
const fallbackDir = path.join(here, 'pkg-fallback')

export function hasRealPkg() {
   // The fallback is copied in under the same .js name, so only the wasm-pack binary tells them apart
   return fs.existsSync(path.join(pkgDir, 'gcode_file_processor_bg.wasm'))
}

export function copyFallbackPkg() {
   fs.mkdirSync(pkgDir, { recursive: true })
   for (const file of fs.readdirSync(fallbackDir)) {
      fs.copyFileSync(path.join(fallbackDir, file), path.join(pkgDir, file))
   }
}

export function ensureWasmPkg({ silent = false } = {}) {
   if (hasRealPkg()) {
      return
   }
   copyFallbackPkg()
   if (!silent) {
      console.warn(
         '[wasm-pkg] Rust toolchain / wasm-pack not available (or WASM has not been built yet) - using the JS fallback stub from WASM_FileProcessor/pkg-fallback. ' +
            'WASM fast-path parsing is disabled; the TypeScript parser is used instead. Run `npm run build:wasm` on a machine with Rust + wasm-pack to enable it.',
      )
   }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
   // dist inlines whatever pkg/ held at build time, so publishing off a fallback build would ship
   // a tarball with no WASM fast path at all and nothing would report it
   if (process.argv.includes('--require-real') && !hasRealPkg()) {
      console.error('[wasm-pkg] Refusing to publish: WASM_FileProcessor/pkg holds the JS fallback stub. Run `npm run build:wasm` followed by `npm run build` first.')
      process.exit(1)
   }
   ensureWasmPkg()
}
