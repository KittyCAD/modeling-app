import { expect, test } from 'vitest'

import { getEstimatedBillingBalance } from '@src/lib/billingEstimate'
import type { BillingContext } from '@src/machines/billingMachine'

const BILLING_CONTEXT_DEFAULTS: BillingContext = {
  balance: undefined,
  allowance: undefined,
  userPaymentBalance: undefined,
  payAsYouGoApiCreditPrice: undefined,
  error: undefined,
  isOrg: undefined,
  hasSubscription: undefined,
  urlUserService: () => '',
  lastFetch: undefined,
  usageStartedAt: undefined,
  usageAccumulatedMs: 0,
  updateApiToken: undefined,
  pendingUpdateApiToken: undefined,
}

function createBillingContext(
  overrides: Partial<BillingContext>
): BillingContext {
  return {
    ...BILLING_CONTEXT_DEFAULTS,
    ...overrides,
  }
}

test('decrements finite balance by active Zookeeper usage time', () => {
  const usageStartedAt = new Date('2026-06-08T12:00:00.000Z')

  expect(
    getEstimatedBillingBalance(
      createBillingContext({
        balance: 20,
        payAsYouGoApiCreditPrice: 0.0083,
        usageStartedAt,
      }),
      usageStartedAt.getTime() + 90_000
    )
  ).toBe(18.5)
})

test('keeps completed usage applied while waiting for a server refresh', () => {
  expect(
    getEstimatedBillingBalance(
      createBillingContext({
        balance: 20,
        payAsYouGoApiCreditPrice: 0.0083,
        usageAccumulatedMs: 120_000,
      })
    )
  ).toBe(18)
})

test('leaves balance unchanged without a pay as you go price', () => {
  expect(
    getEstimatedBillingBalance(
      createBillingContext({
        balance: 20,
        usageAccumulatedMs: 120_000,
      })
    )
  ).toBe(20)
})

test('leaves unlimited account balances unchanged', () => {
  const usageStartedAt = new Date('2026-06-08T12:00:00.000Z')

  expect(
    getEstimatedBillingBalance(
      createBillingContext({
        balance: Number.POSITIVE_INFINITY,
        payAsYouGoApiCreditPrice: 0.0083,
        usageAccumulatedMs: 120_000,
        usageStartedAt,
      }),
      usageStartedAt.getTime() + 90_000
    )
  ).toBe(Number.POSITIVE_INFINITY)
})

test('does not show negative estimated balances', () => {
  expect(
    getEstimatedBillingBalance(
      createBillingContext({
        balance: 1,
        payAsYouGoApiCreditPrice: 0.0083,
        usageAccumulatedMs: 120_000,
      })
    )
  ).toBe(0)
})
