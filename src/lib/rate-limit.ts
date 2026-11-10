// Simple in-memory sliding-window limiter, one bucket per user and scope.
// Works for a single server instance (current Render setup).
const hits = new Map<string, number[]>();

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export function rateLimit(
  scope: string,
  userId: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const key = `${scope}:${userId}`;
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);

  if (recent.length >= limit) {
    hits.set(key, recent);
    const retryAfterMs = windowMs - (now - recent[0]);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }

  recent.push(now);
  hits.set(key, recent);

  // Keep memory small: drop buckets that have gone quiet
  if (hits.size > 5000) {
    for (const [k, times] of hits) {
      if (times.every((t) => now - t >= windowMs)) hits.delete(k);
    }
  }

  return { allowed: true };
}

export function rateLimitedResponse(retryAfterSeconds: number) {
  return Response.json(
    { error: "rate_limited", retry_after_seconds: retryAfterSeconds },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}