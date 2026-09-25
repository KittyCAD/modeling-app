import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import type { CustomerBalance } from '@kittycad/lib'
import type { MouseEvent } from 'react'
import {
  BillingDialog,
  BillingError,
  EBillingError,
} from '@kittycad/ui-components'
import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const userPaymentBalance = {
  created_at: '2026-01-02T21:57:20.048Z',
  monthly_api_credits_remaining: 0,
  monthly_api_credits_remaining_monetary_value: 0,
  stable_api_credits_remaining: 0,
  stable_api_credits_remaining_monetary_value: 0,
  total_due: 14.75,
  updated_at: '2026-01-02T21:57:20.048Z',
} satisfies CustomerBalance

test('Shows account billing action when total due is positive', () => {
  const billingClick = vi.fn((event: MouseEvent<HTMLAnchorElement>) =>
    event.preventDefault()
  )
  const { queryByTestId } = render(
    <BillingDialog
      upgradeHref="https://zoo.dev/design-studio-pricing"
      accountHref="https://dev.zoo.dev/account/billing"
      balance={8}
      allowance={20}
      billingClick={billingClick}
      userPaymentBalance={userPaymentBalance}
    />
  )

  const accountButton = queryByTestId('billing-account-button')
  expect(accountButton).toBeVisible()
  expect(accountButton).toHaveAttribute(
    'href',
    'https://dev.zoo.dev/account/billing'
  )
  expect(queryByTestId('billing-upgrade-button')).toBeNull()

  fireEvent.click(accountButton!)
  expect(billingClick).toHaveBeenCalledOnce()
})

test('Shows total due with two decimal places', () => {
  const { queryByText } = render(
    <BillingDialog
      upgradeHref="https://zoo.dev/design-studio-pricing"
      accountHref="https://dev.zoo.dev/account/billing"
      balance={8}
      allowance={20}
      userPaymentBalance={{
        ...userPaymentBalance,
        total_due: 22.6,
      }}
    />
  )

  expect(queryByText('$22.60')).toBeVisible()
  expect(queryByText('$22.6')).toBeNull()
})

test.each([
  { balance: 596, monthlyCredits: 107.32, stableCredits: 204.82 },
  { balance: 8, monthlyCredits: 0, stableCredits: 4 },
  { balance: 0, monthlyCredits: 0, stableCredits: 0 },
  { balance: Infinity, monthlyCredits: 0, stableCredits: 0 },
])(
  'Does not infer a billing block from recorded charges: %j',
  ({ balance, monthlyCredits, stableCredits }) => {
    render(
      <BillingDialog
        upgradeHref="https://zoo.dev/design-studio-pricing"
        accountHref="https://zoo.dev/account/billing"
        balance={balance}
        allowance={400}
        userPaymentBalance={{
          ...userPaymentBalance,
          monthly_api_credits_remaining_monetary_value: monthlyCredits,
          stable_api_credits_remaining_monetary_value: stableCredits,
          total_due: 35.53,
        }}
      />
    )

    if (Number.isFinite(balance)) {
      expect(
        screen.getByText(`${balance} min of Zookeeper reasoning time remaining`)
      ).toBeVisible()
    } else {
      expect(screen.getByText('Unlimited Zookeeper')).toBeVisible()
    }
    expect(screen.getByText('Recorded charges:')).toBeVisible()
    expect(screen.getByText('$35.53')).toBeVisible()
    expect(screen.getByText(/Available credits may apply/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Go to billing' })).toHaveAttribute(
      'href',
      'https://zoo.dev/account/billing'
    )
    expect(screen.queryByText(/must clear an unpaid total/)).toBeNull()
  }
)

test('Shows upgrade action when total due is zero', () => {
  const { queryByTestId } = render(
    <BillingDialog
      upgradeHref="https://zoo.dev/design-studio-pricing"
      accountHref="https://zoo.dev/account/billing"
      balance={8}
      allowance={20}
      userPaymentBalance={{
        ...userPaymentBalance,
        total_due: 0,
      }}
    />
  )

  expect(queryByTestId('billing-account-button')).toBeNull()
  expect(queryByTestId('billing-upgrade-button')).toBeVisible()
})

const refreshProps = {
  upgradeHref: 'https://zoo.dev/design-studio-pricing',
  accountHref: 'https://zoo.dev/account/billing',
  balance: 0,
  allowance: 20,
  userPaymentBalance: {
    ...userPaymentBalance,
    total_due: 0,
    monthly_api_credits_refresh_at: '2026-09-22T12:02:00Z',
  },
}

test('Counts down to the credit refresh and keeps an overdue refresh pending', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-22T12:00:00Z'))
  const { unmount } = render(<BillingDialog {...refreshProps} />)

  expect(screen.getByText('Credits refresh in 2 minutes')).toBeVisible()
  await act(() => vi.advanceTimersByTime(60_000))
  expect(screen.getByText('Credits refresh in 1 minute')).toBeVisible()
  await act(() => vi.advanceTimersByTime(120_000))
  expect(screen.getByText('Credit refresh pending')).toBeVisible()

  unmount()
  expect(vi.getTimerCount()).toBe(0)
})

test.each([
  { userPaymentBalance: undefined },
  {
    userPaymentBalance: {
      ...refreshProps.userPaymentBalance,
      monthly_api_credits_refresh_at: 'invalid',
    },
  },
  { balance: undefined },
  { balance: Infinity },
  { allowance: 0 },
  { error: new BillingError({ type: EBillingError.CatastrophicRequest }) },
])(
  'Hides the countdown when monthly refresh information is unavailable: %j',
  (overrides) => {
    render(<BillingDialog {...refreshProps} {...overrides} />)
    expect(screen.queryByText(/refresh/i)).not.toBeInTheDocument()
  }
)
