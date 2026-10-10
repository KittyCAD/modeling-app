import type { CustomerBalance } from '@kittycad/lib'
import { BillingError, EBillingError } from '@kittycad/ui-components'
import { HomeBillingReminder } from '@src/routes/HomeBillingReminder'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, expect, test } from 'vitest'

const userPaymentBalance = {
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-10T00:00:00Z',
  monthly_api_credits_remaining: 60,
  monthly_api_credits_remaining_monetary_value: 0.5,
  stable_api_credits_remaining: 0,
  stable_api_credits_remaining_monetary_value: 0,
  monthly_api_credits_refresh_at: '2026-11-01T00:00:00Z',
} satisfies CustomerBalance

const billingContext = {
  balance: 1,
  allowance: 20,
  error: undefined,
  userPaymentBalance,
} satisfies ComponentProps<typeof HomeBillingReminder>['billingContext']

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

test.each([
  { balance: 0, visible: true },
  { balance: 1.99, visible: true },
  { balance: 2, visible: false },
  { balance: 10, visible: false },
])(
  'only shows below 10% remaining: $balance minutes',
  ({ balance, visible }) => {
    render(
      <HomeBillingReminder
        userId="alice"
        billingContext={{ ...billingContext, balance }}
      />
    )

    expect(
      screen.queryByRole('button', { name: 'Dismiss billing reminder' }) !==
        null
    ).toBe(visible)
  }
)

test.each([
  { balance: undefined },
  { balance: Infinity },
  { allowance: 0 },
  { userPaymentBalance: undefined },
  {
    userPaymentBalance: {
      ...userPaymentBalance,
      monthly_api_credits_refresh_at: 'invalid',
    },
  },
  { error: new BillingError({ type: EBillingError.CatastrophicRequest }) },
])('hides when billing or cycle data is unavailable: %j', (overrides) => {
  render(
    <HomeBillingReminder
      userId="alice"
      billingContext={{ ...billingContext, ...overrides }}
    />
  )

  expect(
    screen.queryByRole('button', { name: 'Dismiss billing reminder' })
  ).not.toBeInTheDocument()
})

test('keeps dismissal across remounts and balance changes until the next cycle is low', () => {
  const { unmount } = render(
    <HomeBillingReminder userId="alice" billingContext={billingContext} />
  )
  expect(screen.getByRole('link', { name: 'Upgrade' })).toBeVisible()
  fireEvent.click(
    screen.getByRole('button', { name: 'Dismiss billing reminder' })
  )
  expect(
    window.localStorage.getItem('zoo.homeBillingReminder.dismissed.alice')
  ).toBe(String(Date.parse(userPaymentBalance.monthly_api_credits_refresh_at)))
  unmount()

  const { rerender } = render(
    <HomeBillingReminder userId="alice" billingContext={billingContext} />
  )
  expect(
    screen.queryByRole('link', { name: 'Upgrade' })
  ).not.toBeInTheDocument()

  for (const balance of [20, 1]) {
    rerender(
      <HomeBillingReminder
        userId="alice"
        billingContext={{ ...billingContext, balance }}
      />
    )
    expect(
      screen.queryByRole('link', { name: 'Upgrade' })
    ).not.toBeInTheDocument()
  }

  const nextCycle = {
    ...billingContext,
    userPaymentBalance: {
      ...userPaymentBalance,
      monthly_api_credits_refresh_at: '2026-12-01T00:00:00Z',
    },
  }
  rerender(
    <HomeBillingReminder
      userId="alice"
      billingContext={{ ...nextCycle, balance: 20 }}
    />
  )
  expect(
    screen.queryByRole('link', { name: 'Upgrade' })
  ).not.toBeInTheDocument()

  rerender(<HomeBillingReminder userId="alice" billingContext={nextCycle} />)
  expect(screen.getByRole('link', { name: 'Upgrade' })).toBeVisible()
})

test('isolates dismissal by account and normalizes equivalent cycle timestamps', () => {
  const { rerender } = render(
    <HomeBillingReminder userId="alice" billingContext={billingContext} />
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Dismiss billing reminder' })
  )

  rerender(<HomeBillingReminder userId="bob" billingContext={billingContext} />)
  expect(screen.getByRole('link', { name: 'Upgrade' })).toBeVisible()

  rerender(
    <HomeBillingReminder
      userId="alice"
      billingContext={{
        ...billingContext,
        userPaymentBalance: {
          ...userPaymentBalance,
          monthly_api_credits_refresh_at: '2026-11-01T00:00:00+00:00',
        },
      }}
    />
  )
  expect(
    screen.queryByRole('link', { name: 'Upgrade' })
  ).not.toBeInTheDocument()
})
