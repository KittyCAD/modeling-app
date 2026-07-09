import { fireEvent, render, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import type { CustomerBalance } from '@kittycad/lib'
import {
  BillingError,
  BillingRemaining,
  BillingRemainingMode,
  EBillingError,
} from '@kittycad/ui-components'
import { expect, test } from 'vitest'

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
