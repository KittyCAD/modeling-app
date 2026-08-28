import { shouldUseVercelVisitorPasswordFallback } from '@src/lib/vercelProtection'
import { describe, expect, it } from 'vitest'

describe('Vercel visitor-password fallback', () => {
  it('uses the visitor-password fallback only for protected preview runs without an automation bypass secret', () => {
    expect(
      shouldUseVercelVisitorPasswordFallback({
        VERCEL_BASE_URL: 'https://modeling-app-git-example.vercel.dev.zoo.dev',
        VERCEL_VISITOR_PASSWORD: 'visitor-password',
      })
    ).toBe(true)
  })

  it('does not use the visitor-password fallback when the automation bypass secret is available', () => {
    expect(
      shouldUseVercelVisitorPasswordFallback({
        VERCEL_BASE_URL: 'https://modeling-app-git-example.vercel.dev.zoo.dev',
        VERCEL_VISITOR_PASSWORD: 'visitor-password',
        VERCEL_AUTOMATION_BYPASS_SECRET: 'automation-bypass-secret',
      })
    ).toBe(false)
  })

  it('does not use the visitor-password fallback outside Vercel preview runs', () => {
    expect(
      shouldUseVercelVisitorPasswordFallback({
        VERCEL_VISITOR_PASSWORD: 'visitor-password',
      })
    ).toBe(false)
  })

  it('does not use the visitor-password fallback without a visitor password', () => {
    expect(
      shouldUseVercelVisitorPasswordFallback({
        VERCEL_BASE_URL: 'https://modeling-app-git-example.vercel.dev.zoo.dev',
      })
    ).toBe(false)
  })

  it('does not use the visitor-password fallback for production or staging app targets', () => {
    expect(
      shouldUseVercelVisitorPasswordFallback({
        VERCEL_BASE_URL: 'https://app.zoo.dev',
        VERCEL_VISITOR_PASSWORD: 'visitor-password',
      })
    ).toBe(false)

    expect(
      shouldUseVercelVisitorPasswordFallback({
        VERCEL_BASE_URL: 'https://app.dev.zoo.dev',
        VERCEL_VISITOR_PASSWORD: 'visitor-password',
      })
    ).toBe(false)
  })
})
