import type { BillingContext } from '@src/lib/billing/machine'

const MILLISECONDS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60

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
