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
  total_due?: number | null
  subscription_details?: {
    modeling_app?: {
      price?: { type?: string }
    }
  }
}

/**
 * Whether a contract owns billing, in which case there is no pool to count.
 *
 * Inferred from the subscription's price type rather than from org membership:
 * an org can perfectly well be on a metered per-user plan, so "is in an org" is
 * the wrong question. `CustomerBalance` documents the same distinction from the
 * other side — it says `monthly_api_credits_refresh_at` is null "while a
 * contract owns billing".
 *
 * This is the branch's stand-in for what the existing app expresses as
 * `balance === Infinity`.
 */
function isContractBilled(body: CustomerBalanceResponse): boolean {
  return body.subscription_details?.modeling_app?.price?.type === 'contract'
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
  /**
   * The org whose pool to read, or null for the personal one.
   *
   * A function for the same reason the token is: membership is resolved after
   * sign-in, so a value captured at construction is null forever.
   */
  org?: () => string | null
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

      /*
       * The org's pool when there is one, and this is the whole point of
       * threading org membership through: a member of an org has no personal
       * credits, so reading `/user/payment/balance` reports zero however much
       * the org has. That reads as "you are out of credits".
       */
      const scope = options.org?.() == null ? 'user' : 'org'
      const response = await request(`${baseUrl}/${scope}/payment/balance`, {
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
        unlimited: isContractBilled(body),
        /*
         * Absent rather than zero when the API did not send it: the field is
         * documented as "only returned if requested", so a missing value means
         * "not told" and rendering it as $0.00 owed would be a fabrication.
         */
        totalDue: typeof body.total_due === 'number' ? body.total_due : null,
        scope,
        fetchedAt: Date.now(),
      }
    },
  }
}
