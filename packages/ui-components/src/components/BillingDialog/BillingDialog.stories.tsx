import type { CustomerBalance } from '@kittycad/lib'
import {
  BillingDialog,
  BillingError,
  EBillingError,
} from '@kittycad/ui-components'
import type { Meta, StoryObj } from '@storybook/react-vite'

const overdueBalance = {
  created_at: '2026-01-02T21:57:20.048Z',
  monthly_api_credits_remaining: 0,
  monthly_api_credits_remaining_monetary_value: 0,
  stable_api_credits_remaining: 0,
  stable_api_credits_remaining_monetary_value: 0,
  total_due: 14.75,
  updated_at: '2026-01-02T21:57:20.048Z',
} satisfies CustomerBalance

const meta = {
  title: 'Components/BillingDialog',
  component: BillingDialog,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div style={{ width: 280 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    upgradeHref: 'https://zoo.dev/design-studio-pricing',
    accountHref: 'https://zoo.dev/account/billing',
    balance: 8,
    allowance: 20,
  },
} satisfies Meta<typeof BillingDialog>

export default meta

type Story = StoryObj<typeof meta>

export const LimitedPlan: Story = {}

export const UnlimitedPlan: Story = {
  args: {
    balance: Number.POSITIVE_INFINITY,
    allowance: undefined,
  },
}

export const PaymentOverdue: Story = {
  args: {
    userPaymentBalance: overdueBalance,
  },
}

export const ErrorState: Story = {
  args: {
    error: new BillingError({
      type: EBillingError.CatastrophicRequest,
    }),
  },
}
