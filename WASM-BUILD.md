# WASM Build Instructions

This project includes a Rust/WASM G-code processor for faster file parsing and render buffer generation.

## Prerequisites

1. **Rust** with the `wasm32-unknown-unknown` target (via https://rustup.rs/, or on Arch Linux the `rust` + `rust-wasm` packages)
2. **wasm-pack**: `cargo install wasm-pack`, or your distribution's package

## Building

`npm run build` (and `npm run dev`) rebuild the WASM package automatically whenever a file in
`WASM_FileProcessor/src/` or `Cargo.toml` is newer than the generated `pkg/` output, so no manual
step is needed. Machines without wasm-pack can still build the library as long as a current `pkg/`
exists.

Manual builds are still available:

```bash
# Force a WASM build (web target, used by the library)
npm run build:wasm

# Build WASM for Node.js (testing)
npm run build:wasm:node
```

## Generated Files

- **`WASM_FileProcessor/pkg/`** - web target, imported by the TypeScript library (gitignored)
  - `gcode_file_processor.js` - JavaScript bindings
  - `gcode_file_processor_bg.wasm` - compiled WASM binary
  - `gcode_file_processor.d.ts` - TypeScript definitions
- **`WASM_FileProcessor/pkg-node/`** - Node.js target for testing (gitignored)

## Integration

- `src/wasmprocessor.ts` wraps the wasm-bindgen module; `src/processor.ts` uses it when `enableWasmProcessing()` has been called and falls back to the TypeScript parser otherwise.
- The library build inlines the .wasm binary as a base64 data URI, so consumers need no separate asset handling.

## Coordinate System

G-code is Z-up, Babylon.js is Y-up. Y and Z are swapped at parse time (in both the TypeScript and Rust parsers), so all buffers produced by the WASM module are already in Babylon space.
