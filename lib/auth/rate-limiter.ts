/**
 * Sliding-window Rate Limiter (SEC-305 / P1-6)
 *
 * Implements sliding-window rate limiting for anonymous/demo and authenticated callers:
 * - Demo mode: 10 requests per IP per hour
 * - Authenticated users: 60 requests per user per hour
 */

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
  error?: string;
  failClosed?: boolean;
}

interface WindowRecord {
  timestamps: number[];
}

const rateLimitStore = new Map<string, WindowRecord>();

// Clean up stale entries every 10 minutes
if (typeof setInterval !== 'undefined') {
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimitStore.entries()) {
      record.timestamps = record.timestamps.filter((ts) => now - ts < 3600_000);
      if (record.timestamps.length === 0) {
        rateLimitStore.delete(key);
      }
    }
  }, 10 * 60 * 1000);
  if (cleanupTimer.unref) cleanupTimer.unref();
}

/**
 * Checks rate limit for a given identifier using a sliding-window algorithm.
 *
 * @param key Unique identifier (e.g. `demo:<ip>` or `user:<userId>`)
 * @param maxRequests Maximum requests permitted within the window
 * @param windowMs Window duration in milliseconds (default: 1 hour = 3,600,000ms)
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number = 3600_000
): RateLimitResult {
  const now = Date.now();
  let record = rateLimitStore.get(key);
  if (!record) {
    record = { timestamps: [] };
    rateLimitStore.set(key, record);
  }

  // Filter timestamps within sliding window
  record.timestamps = record.timestamps.filter((ts) => now - ts < windowMs);

  if (record.timestamps.length >= maxRequests) {
    const oldest = record.timestamps[0] || now;
    const resetSeconds = Math.ceil((oldest + windowMs - now) / 1000);
    return {
      allowed: false,
      limit: maxRequests,
      remaining: 0,
      resetSeconds: Math.max(resetSeconds, 1),
    };
  }

  record.timestamps.push(now);
  return {
    allowed: true,
    limit: maxRequests,
    remaining: maxRequests - record.timestamps.length,
    resetSeconds: Math.ceil(windowMs / 1000),
  };
}

/**
 * Resets the rate limit store (used in unit/integration tests)
 */
export function resetRateLimitStore(): void {
  rateLimitStore.clear();
}

/**
 * Asynchronously checks rate limit across distributed server instances (SEC-402 / SEC-501)
 * Primary: PostgreSQL atomic stored function via Supabase REST RPC
 * In fail-closed mode (default for AI routes), failure to contact the distributed backend
 * strictly rejects requests (HTTP 503) rather than falling back to per-instance memory.
 */
export async function checkRateLimitDistributed(
  key: string,
  maxRequests: number,
  windowMs: number = 3600_000,
  options?: { failClosed?: boolean }
): Promise<RateLimitResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const windowSeconds = Math.ceil(windowMs / 1000);
  const failClosed = options?.failClosed ?? true;

  if (supabaseUrl && serviceKey) {
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/rpc/check_rate_limit_atomic`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          p_key: key,
          p_max: maxRequests,
          p_window_seconds: windowSeconds,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        return {
          allowed: Boolean(data.allowed),
          limit: Number(data.limit ?? maxRequests),
          remaining: Number(data.remaining ?? 0),
          resetSeconds: Number(data.resetSeconds ?? windowSeconds),
        };
      }
    } catch {
      // Backend connectivity error
    }
  }

  // Security Invariant (SEC-501): Expensive AI routes MUST fail closed when distributed infrastructure is unreachable
  if (failClosed) {
    return {
      allowed: false,
      limit: maxRequests,
      remaining: 0,
      resetSeconds: windowSeconds,
      error: 'Distributed rate limiting unavailable',
    };
  }

  // Fallback to local in-memory rate limiter only for non-critical routes where explicitly permitted
  return checkRateLimit(key, maxRequests, windowMs);
}
