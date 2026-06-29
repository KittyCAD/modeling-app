import type { CustomerBalance } from '@kittycad/lib'
import {
  BillingError,
  BillingRemaining,
  BillingRemainingMode,
  EBillingError,
} from '@kittycad/ui-components'
import type { Meta, StoryObj } from '@storybook/react-vite'

const userPaymentBalance = {
  created_at: '2026-01-02T21:57:20.048Z',
  monthly_api_credits_remaining: 0,
  monthly_api_credits_remaining_monetary_value: 0,
  stable_api_credits_remaining: 0,
  stable_api_credits_remaining_monetary_value: 0,
  total_due: 14.75,
  updated_at: '2026-01-02T21:57:20.048Z',
} satisfies CustomerBalance

const meta = {
  title: 'Components/BillingRemaining',
  component: BillingRemaining,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
  args: {
    mode: BillingRemainingMode.ProgressBarFixed,
    balance: 8,
    allowance: 20,
  },
} satisfies Meta<typeof BillingRemaining>

export default meta

type Story = StoryObj<typeof meta>

export const Fixed: Story = {}

export const FixedWithOverrun: Story = {
  args: {
    userPaymentBalance,
  },
}

export const Stretch: Story = {
  args: {
    mode: BillingRemainingMode.ProgressBarStretch,
    balance: 8,
    allowance: 20,
  },
  decorators: [
    (Story) => (
      <div style={{ width: 260 }}>
        <Story />
      </div>
    ),
  ],
}

export const Unlimited: Story = {
  args: {
    balance: Number.POSITIVE_INFINITY,
    allowance: undefined,
  },
}

export const Loading: Story = {
  args: {
    balance: undefined,
    allowance: undefined,
  },
}

export const Error: Story = {
  args: {
    error: new BillingError({
      type: EBillingError.CatastrophicRequest,
    }),
  },
}
