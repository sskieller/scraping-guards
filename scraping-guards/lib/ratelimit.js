/* Guard 40: rate-limiting beyond a fixed-window counter.
 * Three independent strategies + progressive backoff, all in-memory. */
"use strict";

/* ---------- Sliding window ---------- */
// A fixed window lets a client burst 2x the limit across a boundary (max at the
// end of window N, max again at the start of N+1). A sliding log has no seam.
class SlidingWindow {
  constructor({ windowMs = 10_000, max = 5 } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.log = new Map(); // key -> timestamp[]
  }
  check(key, now = Date.now()) {
    const cutoff = now - this.windowMs;
    const hits = (this.log.get(key) || []).filter((t) => t > cutoff);
    hits.push(now);
    this.log.set(key, hits);
    const limited = hits.length > this.max;
    return { limited, count: hits.length, retryAfter: limited ? Math.ceil((hits[0] - cutoff) / 1000) : 0 };
  }
}

/* ---------- Token bucket ---------- */
// Allows a genuine human burst but caps the sustained rate a scraper needs.
class TokenBucket {
  constructor({ capacity = 5, refillPerSec = 1 } = {}) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.buckets = new Map(); // key -> {tokens, last}
  }
  check(key, now = Date.now()) {
    const b = this.buckets.get(key) || { tokens: this.capacity, last: now };
    const elapsed = (now - b.last) / 1000;
    b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerSec);
    b.last = now;
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      return { limited: true, tokens: b.tokens, retryAfter: Math.ceil((1 - b.tokens) / this.refillPerSec) };
    }
    b.tokens -= 1;
    this.buckets.set(key, b);
    return { limited: false, tokens: b.tokens, retryAfter: 0 };
  }
}

/* ---------- Progressive backoff / tarpit ---------- */
// Rather than a clean 429 (which tells a scraper exactly when to retry), stall
// the connection for progressively longer. Costs the scraper wall-clock time
// and ties up *its* workers, while a human never hits the threshold.
class Tarpit {
  constructor({ freeHits = 3, stepMs = 250, maxMs = 4000 } = {}) {
    this.freeHits = freeHits;
    this.stepMs = stepMs;
    this.maxMs = maxMs;
    this.hits = new Map();
  }
  delayFor(key) {
    const n = (this.hits.get(key) || 0) + 1;
    this.hits.set(key, n);
    if (n <= this.freeHits) return { delayMs: 0, hits: n };
    return { delayMs: Math.min((n - this.freeHits) * this.stepMs, this.maxMs), hits: n };
  }
  reset(key) { this.hits.delete(key); }
}

module.exports = { SlidingWindow, TokenBucket, Tarpit };
