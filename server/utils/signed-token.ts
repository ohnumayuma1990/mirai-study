import { createHmac, timingSafeEqual } from 'node:crypto'

export interface SignedTokenPayload {
  iss: string
  aud: string
  sub?: string
  email?: string
  state?: string
  scopes?: string[]
  iat: number
  exp: number
  jti?: string
  [key: string]: unknown
}

export function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  return Buffer.from(normalized + padding, 'base64')
}

export function signAgentPayload(rawBody: string | Buffer, secret: string): string {
  if (!secret || secret.length < 32) {
    throw new Error('Signing secret must be at least 32 characters.')
  }
  const sig = createHmac('sha256', secret).update(rawBody).digest()
  return base64UrlEncode(sig)
}

export function verifyAgentSignature(
  rawBody: string | Buffer,
  signature: string,
  secret: string,
): boolean {
  if (!secret || secret.length < 32 || !signature) {
    return false
  }
  const expected = createHmac('sha256', secret).update(rawBody).digest()
  const actual = base64UrlDecode(signature)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) {
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

export function signHmacToken(payload: SignedTokenPayload, secret: string): string {
  if (!secret || secret.length < 32) {
    throw new Error('Signing secret must be at least 32 characters.')
  }
  const header = { alg: 'HS256', typ: 'JWT' }
  const headerB64 = base64UrlEncode(JSON.stringify(header))
  const payloadB64 = base64UrlEncode(JSON.stringify(payload))
  const signingInput = `${headerB64}.${payloadB64}`
  const sig = createHmac('sha256', secret).update(signingInput).digest()
  return `${signingInput}.${base64UrlEncode(sig)}`
}

export interface VerifyHmacTokenOptions {
  secret: string
  expectedAudience: string
  expectedIssuer?: string
  requireSub?: boolean
  nowEpochSeconds?: number
  clockSkewSeconds?: number
}

export function verifyHmacToken(
  token: string,
  options: VerifyHmacTokenOptions,
): SignedTokenPayload {
  if (!options.secret || options.secret.length < 32) {
    throw new Error('Verification secret is not properly configured.')
  }

  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new Error('Malformed token format.')
  }

  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string]

  let header: { alg?: string }
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString('utf8')) as { alg?: string }
  } catch {
    throw new Error('Invalid token header.')
  }

  if (header.alg !== 'HS256') {
    throw new Error('Unsupported token algorithm.')
  }

  const signingInput = `${headerB64}.${payloadB64}`
  const expectedSig = createHmac('sha256', options.secret).update(signingInput).digest()
  const actualSig = base64UrlDecode(signatureB64)

  if (expectedSig.length !== actualSig.length || !timingSafeEqual(expectedSig, actualSig)) {
    throw new Error('Invalid token signature.')
  }

  let payload: SignedTokenPayload
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8')) as SignedTokenPayload
  } catch {
    throw new Error('Invalid token payload.')
  }

  const now = options.nowEpochSeconds ?? Math.floor(Date.now() / 1000)
  const skew = options.clockSkewSeconds ?? 30

  if (typeof payload.exp !== 'number' || now > payload.exp + skew) {
    throw new Error('Token has expired.')
  }

  if (typeof payload.iat !== 'number' || payload.iat > now + skew) {
    throw new Error('Token issued-at time is invalid.')
  }

  if (payload.aud !== options.expectedAudience) {
    throw new Error('Token audience mismatch.')
  }

  if (options.expectedIssuer && payload.iss !== options.expectedIssuer) {
    throw new Error('Token issuer mismatch.')
  }

  const requireSub = options.requireSub ?? true
  if (requireSub && (typeof payload.sub !== 'string' || payload.sub.trim().length === 0)) {
    throw new Error('Token subject is missing.')
  }

  return payload
}
