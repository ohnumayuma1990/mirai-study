import { describe, expect, it } from 'vitest'
import { SlidingWindowRateLimiter } from '../server/utils/rate-limit'

describe('server/utils/rate-limit', () => {
  it('enforces maxRequests within sliding window and resets after window expires', () => {
    const limiter = new SlidingWindowRateLimiter({
      windowMs: 10_000,
      maxRequests: 2,
      maxBuckets: 100,
    })

    const t0 = 1_000_000
    expect(limiter.check('user:1', t0).allowed).toBe(true)
    expect(limiter.check('user:1', t0 + 1000).allowed).toBe(true)
    const third = limiter.check('user:1', t0 + 2000)
    expect(third.allowed).toBe(false)
    expect(third.retryAfterSeconds).toBeGreaterThan(0)

    // After sliding window passes
    expect(limiter.check('user:1', t0 + 11_000).allowed).toBe(true)
  })

  it('throws 429 on assertAllowed when limit exceeded', () => {
    const limiter = new SlidingWindowRateLimiter({
      windowMs: 60_000,
      maxRequests: 1,
    })
    limiter.assertAllowed('ip:1.2.3.4', 5000)
    expect(() => limiter.assertAllowed('ip:1.2.3.4', 5001)).toThrowError()
  })
})
