import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { BillingContext } from '@src/lib/billing'

const { useBillingContext } = vi.hoisted(() => ({
  useBillingContext: vi.fn<() => BillingContext>(),
}))

vi.mock('@src/lib/boot', () => ({
  useApp: () => ({ billing: { useContext: useBillingContext } }),
}))
vi.mock('@src/lib/openWindow', () => ({
  openExternalBrowserIfDesktop: () => undefined,
}))
vi.mock('@src/components/StatusBar/StatusBar', () => ({
  defaultStatusBarItemClassNames: '',
}))
vi.mock('@src/components/Tooltip', () => ({
  default: () => null,
}))

import { ZookeeperCreditsMenu } from '@src/components/ZookeeperCreditsMenu'
import { BILLING_CONTEXT_DEFAULTS } from '@src/lib/billing/machine'

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

test('expires a stale estimate through a 19-hour stall and resumes on a fresh balance', async () => {
  vi.useFakeTimers()
  const startedAt = new Date('2026-09-25T12:00:00Z')
  vi.setSystemTime(startedAt)
  const context = {
    ...BILLING_CONTEXT_DEFAULTS,
    balance: 596,
    allowance: 400,
    payAsYouGoApiCreditPrice: 0.0083,
    usageStartedAt: startedAt,
    usageAccumulatedMs: 0,
    usageEstimateExpiresAt: new Date(startedAt.getTime() + 20 * 60_000),
  }
  useBillingContext.mockReturnValue(context)
  const { rerender } = render(<ZookeeperCreditsMenu />)

  expect(screen.getByTestId('billing-balance')).toHaveTextContent('596 min')
  await act(() => vi.advanceTimersByTime(90_000))
  expect(screen.getByTestId('billing-balance')).toHaveTextContent('594 min')
  await act(() => vi.advanceTimersByTime(18 * 60_000))
  expect(screen.getByTestId('billing-balance')).toHaveTextContent('576 min')
  await act(() => vi.advanceTimersByTime(30_000))
  expect(screen.getByTestId('billing-balance')).toHaveTextContent('596 min')
  expect(vi.getTimerCount()).toBe(0)
  await act(() => vi.advanceTimersByTime(19 * 60 * 60 * 1000))
  expect(screen.getByTestId('billing-balance')).toHaveTextContent('596 min')

  fireEvent.click(screen.getByTestId('billing-remaining-bar'))
  expect(
    screen.getByText('596 min of Zookeeper reasoning time remaining this month')
  ).toBeVisible()

  useBillingContext.mockReturnValue({
    ...context,
    balance: 590,
    lastFetch: new Date(),
    usageStartedAt: new Date(),
    usageEstimateExpiresAt: new Date(Date.now() + 20 * 60_000),
  })
  rerender(<ZookeeperCreditsMenu />)
  expect(screen.getByTestId('billing-balance')).toHaveTextContent('590 min')
  expect(
    screen.getByText('590 min of Zookeeper reasoning time remaining this month')
  ).toBeVisible()
  await act(() => vi.advanceTimersByTime(60_000))
  expect(screen.getByTestId('billing-balance')).toHaveTextContent('589 min')
  expect(
    screen.getByText('589 min of Zookeeper reasoning time remaining this month')
  ).toBeVisible()
})

test('expires a completed estimate when the billing refresh has not arrived', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-25T12:02:00Z'))
  useBillingContext.mockReturnValue({
    ...BILLING_CONTEXT_DEFAULTS,
    balance: 596,
    allowance: 400,
    payAsYouGoApiCreditPrice: 0.0083,
    usageAccumulatedMs: 120_000,
    usageEstimateExpiresAt: new Date('2026-09-25T12:20:00Z'),
  })
  render(<ZookeeperCreditsMenu />)

  expect(screen.getByTestId('billing-balance')).toHaveTextContent('594 min')
  await act(() => vi.advanceTimersByTime(18 * 60_000))
  expect(screen.getByTestId('billing-balance')).toHaveTextContent('596 min')
  expect(vi.getTimerCount()).toBe(0)
})

function billingContextWithCharges(
  monthly: number,
  stable: number,
  due: number
): BillingContext {
  return {
    ...BILLING_CONTEXT_DEFAULTS,
    balance: (monthly + stable) / 0.5,
    allowance: 400,
    payAsYouGoApiCreditPrice: 0.5 / 60,
    userPaymentBalance: {
      created_at: '2026-09-25T12:00:00Z',
      updated_at: '2026-09-25T12:00:00Z',
      monthly_api_credits_remaining: 0,
      stable_api_credits_remaining: 0,
      monthly_api_credits_remaining_monetary_value: monthly,
      stable_api_credits_remaining_monetary_value: stable,
      total_due: due,
    },
  }
}

test.each([
  { monthly: 107.32, stable: 204.82, due: 35.53, minutes: 553, overrun: 0 },
  { monthly: 10, stable: 30, due: 35.53, minutes: 8, overrun: 0 },
  { monthly: 0.1, stable: 0.2, due: 0.3, minutes: 0, overrun: 0 },
  { monthly: 10, stable: 15, due: 35.53, minutes: 0, overrun: 10.53 },
  { monthly: 0, stable: 0, due: 35.53, minutes: 0, overrun: 35.53 },
])(
  'shows $overrun overrun and $minutes minutes after applying $monthly monthly and $stable one-time credits to $due',
  ({ monthly, stable, due, minutes, overrun }) => {
    useBillingContext.mockReturnValue(
      billingContextWithCharges(monthly, stable, due)
    )
    const { rerender } = render(<ZookeeperCreditsMenu />)

    expect(screen.getByTestId('billing-balance')).toHaveTextContent(
      `${minutes} min`
    )
    expect(screen.queryByText('Overrun') !== null).toBe(overrun > 0)
    fireEvent.click(screen.getByTestId('billing-remaining-bar'))
    if (overrun > 0) {
      expect(screen.getByText('Overrun')).toBeVisible()
      expect(
        screen.getByText(`$${overrun.toFixed(2)}`, { selector: 'span' })
      ).toBeVisible()
      expect(screen.getByRole('link', { name: 'Go to billing' })).toBeVisible()
    } else {
      expect(
        screen.getByText(
          `${minutes} min of Zookeeper reasoning time remaining this month`
        )
      ).toBeVisible()
      expect(screen.queryByText(/must clear an unpaid total/)).toBeNull()
    }

    // Re-rendering and reopening the popover must not spend the credits again.
    rerender(<ZookeeperCreditsMenu />)
    fireEvent.click(screen.getByTestId('billing-remaining-bar'))
    fireEvent.click(screen.getByTestId('billing-remaining-bar'))
    expect(screen.getByTestId('billing-balance')).toHaveTextContent(
      `${minutes} min`
    )
  }
)

test('estimates usage from the adjusted balance and restores it at expiry and after a billing refresh', async () => {
  vi.useFakeTimers()
  const startedAt = new Date('2026-09-25T12:00:00Z')
  vi.setSystemTime(startedAt)
  const context = {
    ...billingContextWithCharges(107.32, 204.82, 35.53),
    usageStartedAt: startedAt,
    usageEstimateExpiresAt: new Date(startedAt.getTime() + 20 * 60_000),
  }
  useBillingContext.mockReturnValue(context)
  const { rerender } = render(<ZookeeperCreditsMenu />)
  expect(screen.getByTestId('billing-balance')).toHaveTextContent('553 min')

  await act(() => vi.advanceTimersByTime(2 * 60_000))
  expect(screen.getByTestId('billing-balance')).toHaveTextContent('551 min')
  await act(() => vi.advanceTimersByTime(18 * 60_000))
  expect(screen.getByTestId('billing-balance')).toHaveTextContent('553 min')
  expect(vi.getTimerCount()).toBe(0)

  // The next API response has already applied the credits; do not deduct again.
  useBillingContext.mockReturnValue(billingContextWithCharges(71.79, 204.82, 0))
  rerender(<ZookeeperCreditsMenu />)
  expect(screen.getByTestId('billing-balance')).toHaveTextContent('553 min')
  expect(screen.queryByText('Overrun')).toBeNull()
})
