import { getHeader, type H3Event } from 'h3'

export function getClientIp(event: H3Event): string {
  const forwarded = getHeader(event, 'x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) {
      return first
    }
  }
  const realIp = getHeader(event, 'x-real-ip')?.trim()
  if (realIp) {
    return realIp
  }
  return event.node.req.socket?.remoteAddress ?? 'unknown'
}
