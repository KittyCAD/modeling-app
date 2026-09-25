import type { BillingContext } from '@src/lib/billing/machine'

/**
 * Project the display if all reported charges can be paid with remaining credits.
 * This assumption needs API support: total_due currently includes net invoice
 * obligations that may not be credit-eligible. Never write this projection back
 * into the billing actor or use it to decide whether usage is allowed.
 */
export function getCreditAdjustedBillingContext(
  context: BillingContext
): BillingContext {
  const paymentBalance = context.userPaymentBalance
  const pricePerSecond = context.payAsYouGoApiCreditPrice
  if (
    context.error ||
    !paymentBalance ||
    !Number.isFinite(context.balance) ||
    pricePerSecond === undefined ||
    !Number.isFinite(pricePerSecond) ||
    pricePerSecond <= 0
  ) {
    return context
  }

  const totalDue = paymentBalance.total_due ?? 0
  const monthly = paymentBalance.monthly_api_credits_remaining_monetary_value
  const stable = paymentBalance.stable_api_credits_remaining_monetary_value
  if (
    ![totalDue, monthly, stable].every(
      (amount) => Number.isFinite(amount) && amount >= 0
    )
  ) {
    return context
  }

  // Allocate in cents so exact coverage cannot leave a fractional-cent overrun.
  const dueCents = Math.round(totalDue * 100)
  const monthlyCents = Math.round(monthly * 100)
  const stableCents = Math.round(stable * 100)
  const monthlyApplied = Math.min(monthlyCents, dueCents)
  const stableApplied = Math.min(stableCents, dueCents - monthlyApplied)
  if (monthlyApplied + stableApplied === 0) {
    return context
  }

  const remainingMonthly = (monthlyCents - monthlyApplied) / 100
  const remainingStable = (stableCents - stableApplied) / 100

  return {
    ...context,
    balance: (remainingMonthly + remainingStable) / pricePerSecond / 60,
    userPaymentBalance: {
      ...paymentBalance,
      monthly_api_credits_remaining_monetary_value: remainingMonthly,
      stable_api_credits_remaining_monetary_value: remainingStable,
      total_due: (dueCents - monthlyApplied - stableApplied) / 100,
    },
  }
}
