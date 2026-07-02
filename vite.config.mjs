import path from 'node:path'
import fs from 'node:fs'
import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

// Rebuilds the Rust WASM package when its sources are newer than the generated pkg output,
// so a plain `npm run build`/`npm run dev` never uses a stale or missing WASM module
function wasmPackPlugin() {
  const crateDir = path.resolve(import.meta.dirname, 'WASM_FileProcessor')
  const pkgMarker = path.join(crateDir, 'pkg', 'gcode_file_processor.js')

  function newestSourceMtime(dir) {
    let newest = 0
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name)
      newest = Math.max(newest, entry.isDirectory() ? newestSourceMtime(entryPath) : fs.statSync(entryPath).mtimeMs)
    }
    return newest
  }

  return {
    name: 'wasm-pack-build',
    buildStart() {
      const pkgMtime = fs.existsSync(pkgMarker) ? fs.statSync(pkgMarker).mtimeMs : 0
      const sourceMtime = Math.max(newestSourceMtime(path.join(crateDir, 'src')), fs.statSync(path.join(crateDir, 'Cargo.toml')).mtimeMs)
      if (pkgMtime >= sourceMtime) {
        return
      }
      console.log('[wasm-pack] Rust sources are newer than pkg output, rebuilding WASM package...')
      try {
        execSync('wasm-pack build --target web --out-dir pkg --release', { cwd: crateDir, stdio: 'inherit' })
      } catch (error) {
        throw new Error('WASM build failed. Make sure wasm-pack and the wasm32-unknown-unknown target are installed (cargo install wasm-pack)', { cause: error })
      }
    }
  }
}

export default defineConfig({
  build: {
    minify: false,
    commonjsOptions: {
      include: [/dist/, /node_modules/]
    },
    target: 'esnext',
    lib: {
      formats: ['es', 'cjs'],
      entry: path.resolve(import.meta.dirname, 'src/index.ts'),
      name: 'gcodeviewer',
      fileName: (format) => `index.${format}.js`
    }
  },
  plugins: [
    wasmPackPlugin(),
    dts()
  ]
})
