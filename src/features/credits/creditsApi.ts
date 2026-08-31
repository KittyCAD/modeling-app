import type { CreditBalance } from '@src/contracts/credits'

/**
 * The shape the balance endpoint returns, narrowed to what the readout uses.
 *
 * A local declaration rather than `CustomerBalance` from `@kittycad/lib`: the
 * generated model carries twenty fields about subscriptions and amounts due, and
 * naming the four this reads is what makes it obvious that nothing here depends
 * on the rest.
 */
interface CustomerBalanceResponse {
  monthly_api_credits_remaining?: number
  stable_api_credits_remaining?: number
  monthly_api_credits_refresh_at?: string | null
}

export class CreditsApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

export interface CreditsApi {
  balance(): Promise<CreditBalance>
}

/**
 * The one call the credits readout needs.
 *
 * Hand-rolled against `fetch` rather than through the generated client, for the
 * reason `cloudApi` gives: the token has to be read at call time rather than
 * captured, because a token read once is the token that has since been
 * refreshed. `fetch` is injectable so the service is testable without a network.
 */
export function createCreditsApi(options: {
  token: () => string | null
  baseUrl?: string
  fetch?: typeof fetch
}): CreditsApi {
  const request = options.fetch ?? fetch
  const baseUrl = (
    options.baseUrl ??
    (import.meta.env?.VITE_KC_API_BASE_URL as string | undefined) ??
    ''
  ).replace(/\/+$/, '')

  return {
    async balance() {
      if (!baseUrl) {
        throw new CreditsApiError(0, 'No API base URL is configured.')
      }
      const token = options.token()
      if (!token) {
        throw new CreditsApiError(401, 'Sign in to see your credit balance.')
      }

      const response = await request(`${baseUrl}/user/payment/balance`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      })

      if (!response.ok) {
        let message = response.statusText || `HTTP ${response.status}`
        try {
          const body = (await response.clone().json()) as { message?: unknown }
          if (typeof body.message === 'string') message = body.message
        } catch {
          const text = await response.text().catch(() => '')
          if (text) message = text
        }
        throw new CreditsApiError(response.status, message)
      }

      const body = (await response.json()) as CustomerBalanceResponse
      const refreshAt = body.monthly_api_credits_refresh_at
        ? Date.parse(body.monthly_api_credits_refresh_at)
        : Number.NaN

      return {
        monthlyRemaining: body.monthly_api_credits_remaining ?? 0,
        stableRemaining: body.stable_api_credits_remaining ?? 0,
        refreshAt: Number.isNaN(refreshAt) ? null : refreshAt,
        fetchedAt: Date.now(),
      }
    },
  }
}
