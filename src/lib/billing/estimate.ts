import type { BillingContext } from '@src/lib/billing/machine'

const MILLISECONDS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
// Waiting is not confirmed billable usage, so only estimate for a short window.
export const BILLING_ESTIMATE_DURATION_MS =
  20 * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND

function getUsageElapsedMs(billingContext: BillingContext, now: number) {
  const activeUsageElapsedMs =
    billingContext.usageStartedAt === undefined
      ? 0
      : Math.max(0, now - billingContext.usageStartedAt.getTime())

  return billingContext.usageAccumulatedMs + activeUsageElapsedMs
}

function getEstimatedUsageMinutes(
  elapsedMs: number,
  payAsYouGoApiCreditPrice: number
) {
  const elapsedSeconds = elapsedMs / MILLISECONDS_PER_SECOND
  const estimatedSpend = elapsedSeconds * payAsYouGoApiCreditPrice

  return estimatedSpend / payAsYouGoApiCreditPrice / SECONDS_PER_MINUTE
}

export function getEstimatedBillingBalance(
  billingContext: BillingContext,
  now = Date.now()
) {
  if (
    (billingContext.usageEstimateExpiresAt !== undefined &&
      now >= billingContext.usageEstimateExpiresAt.getTime()) ||
    typeof billingContext.balance !== 'number' ||
    billingContext.balance === Number.POSITIVE_INFINITY ||
    billingContext.payAsYouGoApiCreditPrice === undefined ||
    billingContext.payAsYouGoApiCreditPrice <= 0
  ) {
    return billingContext.balance
  }

  const elapsedMs = getUsageElapsedMs(billingContext, now)
  if (elapsedMs <= 0) {
    return billingContext.balance
  }

  return Math.max(
    0,
    billingContext.balance -
      getEstimatedUsageMinutes(
        elapsedMs,
        billingContext.payAsYouGoApiCreditPrice
      )
  )
}
