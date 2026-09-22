import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/boot', () => ({
  useApp: () => ({
    billing,
    auth: { useToken: () => apiToken },
  }),
}))
vi.mock('@src/components/StatusBar/StatusBar', () => ({
  defaultStatusBarItemClassNames: '',
}))
vi.mock('@src/lib/openWindow', () => ({
  openExternalBrowserIfDesktop: () => undefined,
}))

import { ZookeeperCreditsMenu } from '@src/components/ZookeeperCreditsMenu'
import {
  BILLING_CONTEXT_DEFAULTS,
  type BillingContext,
  BillingTransition,
} from '@src/lib/billing'

let billingContext: BillingContext
let apiToken: string
const billing = {
  useContext: () => billingContext,
  send: vi.fn(),
}

describe('Zookeeper credit refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-22T12:00:00Z'))
    apiToken = 'test-token'
    billing.send.mockClear()
    billingContext = {
      ...BILLING_CONTEXT_DEFAULTS,
      balance: 0,
      allowance: 20,
      userPaymentBalance: {
        created_at: '2026-01-22T00:00:00Z',
        updated_at: '2026-09-22T11:59:00Z',
        monthly_api_credits_refresh_at: '2026-09-22T12:01:00Z',
        monthly_api_credits_remaining: 0,
        monthly_api_credits_remaining_monetary_value: 0,
        stable_api_credits_remaining: 0,
        stable_api_credits_remaining_monetary_value: 0,
      },
    }
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('fetches when due, retries pending refreshes, and stops after the new schedule arrives', async () => {
    const { rerender, unmount } = render(<ZookeeperCreditsMenu />)
    expect(screen.getByText('0 min')).toBeVisible()
    expect(screen.queryByText(/refresh/i)).not.toBeInTheDocument()
    expect(billing.send).not.toHaveBeenCalled()

    await act(() => vi.advanceTimersByTime(60_000))
    expect(screen.queryByText(/refresh/i)).not.toBeInTheDocument()
    expect(billing.send).toHaveBeenCalledExactlyOnceWith({
      type: BillingTransition.Update,
      apiToken: 'test-token',
    })

    await act(() => vi.advanceTimersByTime(60_000))
    expect(billing.send).toHaveBeenCalledTimes(2)

    billingContext = {
      ...billingContext,
      balance: 20,
      userPaymentBalance: {
        ...billingContext.userPaymentBalance!,
        monthly_api_credits_refresh_at: '2026-10-22T00:00:00Z',
      },
    }
    rerender(<ZookeeperCreditsMenu />)
    expect(screen.getByText('20 min')).toBeVisible()
    expect(screen.queryByText(/refresh/i)).not.toBeInTheDocument()
    await act(() => vi.advanceTimersByTime(60_000))
    expect(billing.send).toHaveBeenCalledTimes(2)

    unmount()
    await act(() => vi.advanceTimersByTime(31 * 86_400_000))
    expect(billing.send).toHaveBeenCalledTimes(2)
  })

  it('uses the current token when authentication changes', async () => {
    const { rerender } = render(<ZookeeperCreditsMenu />)
    apiToken = 'rotated-token'
    rerender(<ZookeeperCreditsMenu />)
    await act(() => vi.advanceTimersByTime(60_000))
    expect(billing.send).toHaveBeenCalledExactlyOnceWith({
      type: BillingTransition.Update,
      apiToken: 'rotated-token',
    })
  })

  it.each(['missing token', 'unlimited plan', 'missing schedule'])(
    'does not poll with a %s',
    async (condition) => {
      if (condition === 'missing token') apiToken = ''
      if (condition === 'unlimited plan') billingContext.balance = Infinity
      if (condition === 'missing schedule') {
        billingContext.userPaymentBalance = undefined
      }
      render(<ZookeeperCreditsMenu />)
      await act(() => vi.advanceTimersByTime(120_000))
      expect(billing.send).not.toHaveBeenCalled()
    }
  )
})
