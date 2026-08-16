/* Generates wasm/challenge.wasm — the WebAssembly decode routine for guard 51.
 *
 * There is no wat2wasm/emscripten here, so the module is hand-assembled from
 * the binary format. It exports one function:
 *
 *     solve(i32) -> i32      // returns x ^ 0x5A
 *
 * Trivial logic on purpose — the POINT is that the logic lives in a wasm binary
 * rather than readable JS. A scraper must instantiate and run the module (or
 * disassemble it) instead of lifting a constant out of source.
 *
 * Usage: node tools/make-wasm.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const KEY = 0x5a;

// --- section builders ---------------------------------------------------
const section = (id, payload) => Buffer.concat([Buffer.from([id, payload.length]), payload]);

const HEADER = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]); // "\0asm", version 1

// Type section: one signature (i32) -> i32
const TYPE = section(0x01, Buffer.from([0x01, 0x60, 0x01, 0x7f, 0x01, 0x7f]));

// Function section: one function using type 0
const FUNC = section(0x03, Buffer.from([0x01, 0x00]));

// Export section: export "solve" as func 0
const name = Buffer.from("solve", "utf8");
const EXPORT = section(0x07, Buffer.concat([
  Buffer.from([0x01, name.length]), name, Buffer.from([0x00, 0x00]),
]));

// Code section: local.get 0; i32.const KEY; i32.xor; end
// 0x5A has bit 6 set, so signed LEB128 needs a trailing 0x00 continuation byte.
const body = Buffer.from([
  0x00,             // 0 local declarations
  0x20, 0x00,       // local.get 0
  0x41, 0xda, 0x00, // i32.const 0x5A  (signed LEB128)
  0x73,             // i32.xor
  0x0b,             // end
]);
const CODE = section(0x0a, Buffer.concat([Buffer.from([0x01, body.length]), body]));

const wasm = Buffer.concat([HEADER, TYPE, FUNC, EXPORT, CODE]);

// --- verify before writing ----------------------------------------------
const mod = new WebAssembly.Module(wasm);
const inst = new WebAssembly.Instance(mod);
for (const probe of [0, 1, 65, 200, 255]) {
  const got = inst.exports.solve(probe);
  const want = probe ^ KEY;
  if (got !== want) throw new Error(`wasm solve(${probe}) = ${got}, expected ${want}`);
}

const outDir = path.join(path.dirname(__dirname), "wasm");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "challenge.wasm");
fs.writeFileSync(outFile, wasm);

// Emit the ciphertext the page should ship for the flag.
const PLAIN = "FLAG-WASM-9b31";
const cipher = Buffer.from([...Buffer.from(PLAIN, "utf8")].map((b) => b ^ KEY)).toString("base64");
console.log(`wrote ${outFile} (${wasm.length} bytes), verified against WebAssembly`);
console.log(`  plaintext : ${PLAIN}`);
console.log(`  ciphertext: ${cipher}   <-- put THIS in the DOM`);
