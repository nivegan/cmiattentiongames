// seedRng.ts
// Shared seeded random-number utilities used by both client-side game pages
// (Steady Gaze and Clear the Air) to produce deterministic, reproducible game
// data from today's IST date.
//
// "Deterministic" means: every player sees the same dot/bubble positions on the
// same day, but different ones the next day. The positions are not truly random —
// they are computed from a seed (today's date string) so they are *reproducible*.
//
// "Seeded PRNG" = pseudo-random number generator where you supply a starting
// number (the seed) and it produces a predictable sequence of "random" numbers.
// Same seed → same sequence, always.

// ── djb2 hash ──────────────────────────────────────────────────────────────
// Converts a string (like "2026-06-05steady_gaze") to a stable uint32 integer.
// This integer becomes the seed for mulberry32.
//
// WHY NOT Math.sin?
// A Math.sin(hash)-style hash gives a float in (-1, 1) — fine for simple
// color/speed values. But mulberry32 needs a full 32-bit integer to produce
// well-distributed spawn positions. Using a float as the seed would concentrate
// all output values in a narrow band, making dot positions cluster together.
//
// >>> 0 forces any JavaScript number to an unsigned 32-bit integer (uint32),
// discarding bits beyond bit 31 and ensuring the result is always positive.
const getDailySeed = (str: string): number => {
  let hash = 5381; // djb2 magic starting value (chosen empirically for good distribution)
  for (let i = 0; i < str.length; i++) {
    // Math.imul performs true 32-bit integer multiplication, preventing
    // floating-point precision loss that would corrupt the hash at large values.
    // XOR (^) mixes in the ASCII code of the current character.
    hash = (Math.imul(hash, 33) ^ str.charCodeAt(i)) >>> 0;
  }
  return hash; // a uint32 integer
};

// ── IST date string ────────────────────────────────────────────────────────
// Returns today's date as "YYYY-MM-DD" in India Standard Time (UTC+5:30).
// Adding 5.5 hours in milliseconds shifts the UTC clock to IST before extracting
// the date, so the day boundary resets at IST midnight, not UTC midnight.
const getTodayIST = (): string => {
  const now = new Date();
  return new Date(now.getTime() + 5.5 * 60 * 60 * 1000)
    .toISOString() // e.g. "2026-06-05T18:30:00.000Z" (UTC form of IST midnight)
    .split("T")[0]; // take only the date part → "2026-06-05"
};

// ── mulberry32 PRNG ────────────────────────────────────────────────────────
// Returns a *function* that, when called repeatedly, yields the next pseudo-
// random float in [0, 1) from a deterministic sequence seeded by `seed`.
//
// mulberry32 is a fast, well-distributed 32-bit PRNG — suitable for game
// spawn patterns, not for cryptography.
//
// USAGE EXAMPLE:
//   const rng = mulberry32(getDailySeed("2026-06-05steady_gaze"));
//   rng()  // → 0.472... (always the same for this seed)
//   rng()  // → 0.831... (the second value in the sequence)
//   rng()  // → 0.114... (the third value ...)
const mulberry32 = (seed: number): (() => number) => {
  let s = seed >>> 0; // ensure the internal state starts as a uint32
  return () => {
    // Each call advances `s` and derives a pseudo-random 32-bit integer via
    // a chain of multiply + XOR + bit-shift operations. The specific constants
    // (0x6d2b79f5, etc.) are chosen to maximise output distribution quality.
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (Math.imul(t ^ (t >>> 7), 61 | t) ^ t) >>> 0;
    // Dividing a uint32 by 2^32 maps it to a float in [0, 1)
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
};

export { getDailySeed, getTodayIST, mulberry32 };
