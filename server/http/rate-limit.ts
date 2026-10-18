/**
 * Fixed-window rate limiting.
 *
 * This is an in-process limiter. On a serverless platform each instance keeps
 * its own counters, so it blunts brute-force and accidental hammering but is not
 * a global quota. A shared store (for example a table or a managed Redis) is the
 * correct upgrade once traffic justifies the cost; that is recorded as a known
 * limitation rather than presented as a complete solution.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_TRACKED_KEYS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  now: number = Date.now(),
): RateLimitResult {
  if (buckets.size > MAX_TRACKED_KEYS) {
    for (const [existingKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(existingKey);
    }
    // If still oversized, drop the oldest entries rather than growing without bound.
    if (buckets.size > MAX_TRACKED_KEYS) {
      const excess = buckets.size - MAX_TRACKED_KEYS;
      let removed = 0;
      for (const existingKey of buckets.keys()) {
        buckets.delete(existingKey);
        removed += 1;
        if (removed >= excess) break;
      }
    }
  }

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: windowSeconds };
  }

  bucket.count += 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  if (bucket.count > limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }
  return { allowed: true, remaining: Math.max(0, limit - bucket.count), retryAfterSeconds };
}

export function resetRateLimits(): void {
  buckets.clear();
}

export const RATE_LIMITS = {
  register: { limit: 5, windowSeconds: 900 },
  login: { limit: 10, windowSeconds: 900 },
  passwordChange: { limit: 5, windowSeconds: 900 },
  write: { limit: 60, windowSeconds: 300 },
  read: { limit: 300, windowSeconds: 300 },
} as const;
