import { createError, defineEventHandler, sendRedirect, setCookie, setResponseHeader } from 'h3'
import { SSO_STATE_COOKIE_NAME, SSO_STATE_TTL_SECONDS } from '../../../../shared/schemas/sso'
import { A2A_AGENT_ID } from '../../../../shared/schemas/a2a'
import { ssoRateLimiter } from '../../../utils/rate-limit'
import { getClientIp } from '../../../utils/request-ip'
import { generateSsoState, validateStrictOrigin } from '../../../utils/sso'

export default defineEventHandler((event) => {
  const ip = getClientIp(event)
  ssoRateLimiter.assertAllowed(`sso:ip:${ip}`)

  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'Referrer-Policy', 'no-referrer')

  const config = useRuntimeConfig()
  if (!config.ssoEnabled) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden: SSO is disabled.',
    })
  }

  const providerOrigin = validateStrictOrigin(
    String(config.ssoProviderOrigin ?? ''),
    'NUXT_SSO_PROVIDER_ORIGIN',
  )

  const state = generateSsoState()
  const isProd = process.env.NODE_ENV === 'production'

  setCookie(event, SSO_STATE_COOKIE_NAME, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/api/auth/sso',
    maxAge: SSO_STATE_TTL_SECONDS,
  })

  const redirectUrl = `${providerOrigin}/sso/${A2A_AGENT_ID}?state=${state}`
  return sendRedirect(event, redirectUrl, 302)
})
