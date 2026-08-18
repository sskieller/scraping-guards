/* Guard 78: steganographic per-copy text watermarking.
 *
 * Guard 41's canary is a separate field, so it dies the instant someone copies
 * the prose out of the page — which is exactly the moment you most want it.
 * This encodes the recipient's identity INSIDE the text using zero-width
 * characters, so the watermark rides along through copy-paste, through a
 * re-publish, and through most naive "clean the HTML" passes.
 *
 * Encoding: U+200B (ZWSP) = 0, U+200C (ZWNJ) = 1, one bit per character,
 * distributed across word gaps. The visible text is byte-identical once the
 * zero-width characters are stripped.
 *
 * Limits, stated plainly: any normalisation that strips non-printing
 * characters removes it, and so does retyping or OCR round-tripping. It is a
 * forensic aid for the lazy-copy case, not DRM. Note also that screen readers
 * and braille displays may handle stray zero-width characters poorly — use it
 * on body prose, not on labels or navigation.
 */
"use strict";

const ZERO = "​"; // ZWSP
const ONE = "‌";  // ZWNJ
const ZW_RE = /[​‌]/g;

function toBits(payload) {
  return [...Buffer.from(payload, "utf8")]
    .map((b) => b.toString(2).padStart(8, "0"))
    .join("");
}

function fromBits(bits) {
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes).toString("utf8");
}

/* Embed `payload` into `text`. Bits are spread across the gaps between words;
 * any remainder is appended, so short text still carries the full mark. */
function embed(text, payload) {
  const bits = toBits(payload);
  const marks = [...bits].map((b) => (b === "1" ? ONE : ZERO));
  const words = text.split(" ");
  let out = "";
  let bit = 0;
  for (let i = 0; i < words.length; i++) {
    out += words[i];
    if (i < words.length - 1) {
      if (bit < marks.length) out += marks[bit++];
      out += " ";
    }
  }
  while (bit < marks.length) out += marks[bit++]; // remainder rides at the end
  return out;
}

function extract(text) {
  const marks = String(text).match(ZW_RE);
  if (!marks) return null;
  const bits = marks.map((c) => (c === ONE ? "1" : "0")).join("");
  const decoded = fromBits(bits);
  return decoded || null;
}

/* The visible text, exactly as a reader sees it. */
function strip(text) {
  return String(text).replace(ZW_RE, "");
}

module.exports = { embed, extract, strip, ZERO, ONE };
