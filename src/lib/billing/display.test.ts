import type { CustomerBalance } from '@kittycad/lib'
import { getCreditAdjustedBillingContext } from '@src/lib/billing/display'
import {
  BILLING_CONTEXT_DEFAULTS,
  type BillingContext,
} from '@src/lib/billing/machine'
import fc from 'fast-check'
import { expect, test } from 'vitest'

const paymentBalance: CustomerBalance = {
  created_at: '2026-09-25T12:00:00Z',
  updated_at: '2026-09-25T12:00:00Z',
  monthly_api_credits_remaining: 0,
  stable_api_credits_remaining: 0,
  monthly_api_credits_remaining_monetary_value: 107.32,
  stable_api_credits_remaining_monetary_value: 204.82,
  total_due: 35.53,
}

const context: BillingContext = {
  ...BILLING_CONTEXT_DEFAULTS,
  balance: 624.28,
  allowance: 400,
  payAsYouGoApiCreditPrice: 0.5 / 60,
  userPaymentBalance: paymentBalance,
}

test('uses monthly credits first and reduces the displayed minutes without changing the API balance', () => {
  const original = structuredClone(paymentBalance)
  const result = getCreditAdjustedBillingContext(context)

  expect(result.balance).toBeCloseTo(553.22)
  expect(result.allowance).toBe(400)
  expect(result.userPaymentBalance).toMatchObject({
    monthly_api_credits_remaining_monetary_value: 71.79,
    stable_api_credits_remaining_monetary_value: 204.82,
    total_due: 0,
  })
  expect(context.balance).toBe(624.28)
  expect(paymentBalance).toEqual(original)
})

test('uses one-time credits after monthly credits and leaves only the uncovered amount due', () => {
  const result = getCreditAdjustedBillingContext({
    ...context,
    userPaymentBalance: {
      ...paymentBalance,
      monthly_api_credits_remaining_monetary_value: 10,
      stable_api_credits_remaining_monetary_value: 15,
    },
  })

  expect(result.balance).toBe(0)
  expect(result.userPaymentBalance).toMatchObject({
    monthly_api_credits_remaining_monetary_value: 0,
    stable_api_credits_remaining_monetary_value: 0,
    total_due: 10.53,
  })
})

test.each([
  { balance: Number.POSITIVE_INFINITY },
  { balance: undefined },
  { userPaymentBalance: undefined },
  { payAsYouGoApiCreditPrice: undefined },
  { payAsYouGoApiCreditPrice: 0 },
  { payAsYouGoApiCreditPrice: Number.NaN },
  { userPaymentBalance: { ...paymentBalance, total_due: undefined } },
  { userPaymentBalance: { ...paymentBalance, total_due: 0 } },
  { userPaymentBalance: { ...paymentBalance, total_due: -1 } },
  { userPaymentBalance: { ...paymentBalance, total_due: Number.NaN } },
  {
    userPaymentBalance: {
      ...paymentBalance,
      monthly_api_credits_remaining_monetary_value: Number.NaN,
    },
  },
  {
    userPaymentBalance: {
      ...paymentBalance,
      stable_api_credits_remaining_monetary_value: -1,
    },
  },
])('preserves unlimited, missing, or invalid billing data: %j', (overrides) => {
  const original = { ...context, ...overrides }
  expect(getCreditAdjustedBillingContext(original)).toBe(original)
})

test('conserves credits and charges in cents, including exact coverage', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 100_000 }),
      fc.integer({ min: 0, max: 100_000 }),
      fc.integer({ min: 0, max: 200_000 }),
      (monthly, stable, due) => {
        const result = getCreditAdjustedBillingContext({
          ...context,
          balance: (monthly + stable) / 100 / 0.5,
          userPaymentBalance: {
            ...paymentBalance,
            monthly_api_credits_remaining_monetary_value: monthly / 100,
            stable_api_credits_remaining_monetary_value: stable / 100,
            total_due: due / 100,
          },
        })
        const remaining = result.userPaymentBalance
        expect(remaining).toBeDefined()
        if (!remaining) return

        const remainingMonthly = Math.round(
          remaining.monthly_api_credits_remaining_monetary_value * 100
        )
        const remainingStable = Math.round(
          remaining.stable_api_credits_remaining_monetary_value * 100
        )
        const remainingDue = Math.round((remaining.total_due ?? 0) * 100)
        const applied = due - remainingDue
        expect(remainingMonthly + remainingStable + applied).toBe(
          monthly + stable
        )
        expect(remainingDue).toBe(Math.max(0, due - monthly - stable))
        expect(remainingMonthly).toBeGreaterThanOrEqual(0)
        expect(remainingStable).toBeGreaterThanOrEqual(0)
        if (remainingStable < stable) expect(remainingMonthly).toBe(0)
        expect(result.balance).toBeCloseTo(
          (remainingMonthly + remainingStable) / 100 / 0.5
        )
      }
    ),
    {
      examples: [
        [10, 20, 30],
        [10, 19, 30],
        [10, 21, 30],
        [0, 0, 35],
      ],
    }
  )
})
