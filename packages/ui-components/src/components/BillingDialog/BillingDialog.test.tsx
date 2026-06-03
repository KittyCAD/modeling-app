import { fireEvent, render } from '@testing-library/react'
import '@testing-library/jest-dom'
import type { CustomerBalance } from '@kittycad/lib'
import { BillingDialog } from '@kittycad/ui-components'
import { expect, test, vi } from 'vitest'

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
  const accountClick = vi.fn()
  const { queryByTestId } = render(
    <BillingDialog
      upgradeHref="https://zoo.dev/design-studio-pricing"
      balance={8}
      allowance={20}
      accountClick={accountClick}
      userPaymentBalance={userPaymentBalance}
    />
  )

  const accountButton = queryByTestId('billing-account-button')
  expect(accountButton).toBeVisible()
  expect(queryByTestId('billing-upgrade-button')).toBeNull()

  fireEvent.click(accountButton!)
  expect(accountClick).toHaveBeenCalledOnce()
})

test('Shows upgrade action when total due is zero', () => {
  const { queryByTestId } = render(
    <BillingDialog
      upgradeHref="https://zoo.dev/design-studio-pricing"
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
