import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import '@testing-library/jest-dom'
import type { CustomerBalance } from '@kittycad/lib'
import {
  BillingError,
  BillingRemaining,
  BillingRemainingMode,
  EBillingError,
} from '@kittycad/ui-components'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const userPaymentBalance = {
  created_at: '2026-01-02T21:57:20.048Z',
  monthly_api_credits_remaining: 0,
  monthly_api_credits_remaining_monetary_value: 0,
  stable_api_credits_remaining: 0,
  stable_api_credits_remaining_monetary_value: 0,
  total_due: 0,
  updated_at: '2026-01-02T21:57:20.048Z',
} satisfies CustomerBalance

test('Shows a loading spinner when uninitialized credit count', async () => {
  const { queryByTestId } = render(
    <BillingRemaining mode={BillingRemainingMode.ProgressBarFixed} />
  )

  expect(queryByTestId('spinner')).toBeVisible()
  expect(queryByTestId('billing-remaining-error-indicator')).toBeNull()
})

test('Shows an error message when billing fails', async () => {
  const billingError = new BillingError({
    type: EBillingError.CatastrophicRequest,
  })
  const { queryByTestId } = render(
    <BillingRemaining
      mode={BillingRemainingMode.ProgressBarFixed}
      error={billingError}
    />
  )

  const indicator = queryByTestId('billing-remaining-error-indicator')
  expect(indicator).toBeVisible()
  fireEvent.mouseOver(indicator!)
  const queryError = () => queryByTestId('billing-remaining-error-message')
  await waitFor(queryError)
  const error = queryError()
  expect(error).toBeVisible()
  expect(error).toHaveTextContent('Error fetching billing: CatastrophicRequest')
})

test('Progress bar reflects ratio left of Free subscription', async () => {
  const totalBalance = 1
  const monthlyBalance = 10
  const { queryByTestId } = render(
    <BillingRemaining
      mode={BillingRemainingMode.ProgressBarFixed}
      balance={totalBalance}
      allowance={monthlyBalance}
    />
  )

  within(queryByTestId('billing-balance')!).getByText('1 min')
  expect(queryByTestId('billing-remaining-progress-bar-inner')).toHaveStyle({
    width: '10.00%',
  })
  expect(queryByTestId('billing-remaining-error-indicator')).toBeNull()
})

test('Progress bar reflects ratio left of Free subscription with under 1 left', async () => {
  const totalBalance = 0.99
  const monthlyBalance = 10
  const { queryByTestId } = render(
    <BillingRemaining
      mode={BillingRemainingMode.ProgressBarFixed}
      balance={totalBalance}
      allowance={monthlyBalance}
    />
  )

  within(queryByTestId('billing-balance')!).getByText('< 1 min')
  expect(queryByTestId('billing-remaining-progress-bar-inner')).toHaveStyle({
    width: '9.90%',
  })
  expect(queryByTestId('billing-remaining-error-indicator')).toBeNull()
})

test('Progress bar reflects ratio left of Free subscription with 0 left', async () => {
  const totalBalance = 0
  const monthlyBalance = 10
  const { queryByTestId } = render(
    <BillingRemaining
      mode={BillingRemainingMode.ProgressBarFixed}
      balance={totalBalance}
      allowance={monthlyBalance}
    />
  )

  within(queryByTestId('billing-balance')!).getByText('0 min')
  expect(queryByTestId('billing-remaining-progress-bar-inner')).toHaveStyle({
    width: '0.00%',
  })
  expect(queryByTestId('billing-remaining-error-indicator')).toBeNull()
})

test('Shows infinite balance for Pro subscription data', async () => {
  const { queryByTestId } = render(
    <BillingRemaining
      mode={BillingRemainingMode.ProgressBarFixed}
      balance={Number.POSITIVE_INFINITY}
    />
  )

  expect(queryByTestId('infinity')).toBeVisible()
  expect(queryByTestId('billing-remaining-progress-bar-inline')).toBeNull()
  expect(queryByTestId('billing-remaining-error-indicator')).toBeNull()
})

test('Hides overrun when total due is zero', async () => {
  const { queryByText } = render(
    <BillingRemaining
      mode={BillingRemainingMode.ProgressBarFixed}
      userPaymentBalance={userPaymentBalance}
    />
  )

  expect(queryByText('Overrun')).toBeNull()
})

test('Shows total due with two decimal places', async () => {
  const { queryByText } = render(
    <BillingRemaining
      mode={BillingRemainingMode.ProgressBarFixed}
      userPaymentBalance={{
        ...userPaymentBalance,
        total_due: 1.3,
      }}
    />
  )

  expect(queryByText('Overrun')).toBeVisible()
  expect(queryByText('1.30')).toBeVisible()
  expect(queryByText('1.3')).toBeNull()
})

describe('credit refresh countdown', () => {
  const now = new Date('2026-09-22T12:00:00Z')
  const paymentBalance = {
    ...userPaymentBalance,
    monthly_api_credits_refresh_at: '2026-09-25T16:00:00Z',
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  test.each([
    ['2026-09-25T16:00:00Z', '3 days'],
    ['2026-09-23T00:30:00Z', '13 hours'],
    ['2026-09-22T12:25:00Z', '25 minutes'],
    ['2026-09-22T12:00:30Z', '30 seconds'],
    ['2026-09-22T14:25:00+02:00', '25 minutes'],
  ])(
    'shows time until %s below the expanded credit bar',
    (refreshAt, expected) => {
      render(
        <BillingRemaining
          mode={BillingRemainingMode.ProgressBarStretch}
          balance={0}
          allowance={20}
          userPaymentBalance={{
            ...paymentBalance,
            monthly_api_credits_refresh_at: refreshAt,
          }}
        />
      )

      const countdown = screen.getByText(`Credits refresh in ${expected}`)
      expect(countdown).toBeVisible()
      expect(countdown).toHaveAttribute('datetime', refreshAt)
      expect(countdown).toHaveAttribute(
        'title',
        `Credit refresh scheduled for ${new Date(refreshAt).toLocaleString()}`
      )
    }
  )

  test('updates while idle and keeps an overdue refresh pending until new data arrives', async () => {
    const props = {
      mode: BillingRemainingMode.ProgressBarStretch,
      balance: 0,
      allowance: 20,
      userPaymentBalance: {
        ...paymentBalance,
        monthly_api_credits_refresh_at: '2026-09-22T12:02:00Z',
      },
    }
    const { rerender, unmount } = render(<BillingRemaining {...props} />)
    expect(screen.getByText('Credits refresh in 2 minutes')).toBeVisible()

    await act(() => vi.advanceTimersByTime(60_000))
    expect(screen.getByText('Credits refresh in 1 minute')).toBeVisible()
    await act(() => vi.advanceTimersByTime(60_000))
    expect(screen.getByText('Credit refresh pending')).toBeVisible()
    await act(() => vi.advanceTimersByTime(60_000))
    expect(screen.getByText('Credit refresh pending')).toBeVisible()

    rerender(
      <BillingRemaining
        {...props}
        balance={20}
        userPaymentBalance={paymentBalance}
      />
    )
    expect(screen.getByText('Credits refresh in 3 days')).toBeVisible()

    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  test('updates immediately when returning to a suspended window', () => {
    render(
      <BillingRemaining
        mode={BillingRemainingMode.ProgressBarStretch}
        balance={8}
        allowance={20}
        userPaymentBalance={paymentBalance}
      />
    )
    act(() => {
      vi.setSystemTime(new Date('2026-09-26T12:00:00Z'))
      window.dispatchEvent(new Event('focus'))
    })
    expect(screen.getByText('Credit refresh pending')).toBeVisible()
  })

  test.each([
    {
      balance: undefined,
      allowance: 20,
      refreshAt: paymentBalance.monthly_api_credits_refresh_at,
    },
    {
      balance: Number.POSITIVE_INFINITY,
      allowance: 20,
      refreshAt: paymentBalance.monthly_api_credits_refresh_at,
    },
    {
      balance: 8,
      allowance: 0,
      refreshAt: paymentBalance.monthly_api_credits_refresh_at,
    },
    { balance: 8, allowance: 20, refreshAt: undefined },
    { balance: 8, allowance: 20, refreshAt: 'invalid-date' },
  ])(
    'hides a countdown without a usable monthly schedule: %j',
    ({ balance, allowance, refreshAt }) => {
      render(
        <BillingRemaining
          mode={BillingRemainingMode.ProgressBarStretch}
          balance={balance}
          allowance={allowance}
          userPaymentBalance={{
            ...paymentBalance,
            monthly_api_credits_refresh_at: refreshAt,
          }}
        />
      )
      expect(screen.queryByText(/refresh/i)).not.toBeInTheDocument()
    }
  )

  test('hides stale refresh information on billing errors', () => {
    render(
      <BillingRemaining
        mode={BillingRemainingMode.ProgressBarStretch}
        balance={8}
        allowance={20}
        error={new BillingError({ type: EBillingError.CatastrophicRequest })}
        userPaymentBalance={paymentBalance}
      />
    )
    expect(screen.queryByText(/refresh/i)).not.toBeInTheDocument()
  })
})
