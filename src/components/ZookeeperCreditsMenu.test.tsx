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

test('expires the live estimate after twenty minutes and keeps the reported balance through a 19-hour stall', async () => {
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

  useBillingContext.mockReturnValue({ ...context, balance: 590 })
  rerender(<ZookeeperCreditsMenu />)
  expect(screen.getByTestId('billing-balance')).toHaveTextContent('590 min')
  expect(
    screen.getByText('590 min of Zookeeper reasoning time remaining this month')
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
