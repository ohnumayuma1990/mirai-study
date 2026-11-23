import { createError } from 'h3'

interface RateLimitBucket {
  timestamps: number[]
  lastSeenMs: number
}

export interface SlidingWindowRateLimiterOptions {
  windowMs: number
  maxRequests: number
  maxBuckets?: number
}

export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>()
  private readonly windowMs: number
  private readonly maxRequests: number
  private readonly maxBuckets: number

  constructor(options: SlidingWindowRateLimiterOptions) {
    this.windowMs = options.windowMs
    this.maxRequests = options.maxRequests
    this.maxBuckets = options.maxBuckets ?? 2000
  }

  private pruneExpired(nowMs: number): void {
    const cutoff = nowMs - this.windowMs
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.lastSeenMs < cutoff) {
        this.buckets.delete(key)
      }
    }
    // Enforce hard memory cap by evicting oldest keys
    while (this.buckets.size > this.maxBuckets) {
      const oldestKey = this.buckets.keys().next().value
      if (oldestKey === undefined) break
      this.buckets.delete(oldestKey)
    }
  }

  check(key: string, nowMs: number = Date.now()): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
    this.pruneExpired(nowMs)

    const cutoff = nowMs - this.windowMs
    const existing = this.buckets.get(key)
    const activeTimestamps = existing ? existing.timestamps.filter((t) => t > cutoff) : []

    if (activeTimestamps.length >= this.maxRequests) {
      const oldestActive = activeTimestamps[0] ?? nowMs
      const retryAfterMs = Math.max(1000, oldestActive + this.windowMs - nowMs)
      this.buckets.set(key, { timestamps: activeTimestamps, lastSeenMs: nowMs })
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      }
    }

    activeTimestamps.push(nowMs)
    this.buckets.set(key, { timestamps: activeTimestamps, lastSeenMs: nowMs })
    return {
      allowed: true,
      remaining: Math.max(0, this.maxRequests - activeTimestamps.length),
      retryAfterSeconds: 0,
    }
  }

  assertAllowed(key: string, nowMs: number = Date.now()): void {
    const result = this.check(key, nowMs)
    if (!result.allowed) {
      throw createError({
        statusCode: 429,
        statusMessage: `Too Many Requests: Please retry after ${result.retryAfterSeconds} seconds.`,
      })
    }
  }

  reset(): void {
    this.buckets.clear()
  }
}

export const visionRateLimiter = new SlidingWindowRateLimiter({
  windowMs: 60_000,
  maxRequests: 10,
  maxBuckets: 2000,
})

export const a2aRateLimiter = new SlidingWindowRateLimiter({
  windowMs: 60_000,
  maxRequests: 30,
  maxBuckets: 2000,
})

export const ssoRateLimiter = new SlidingWindowRateLimiter({
  windowMs: 60_000,
  maxRequests: 20,
  maxBuckets: 2000,
})
