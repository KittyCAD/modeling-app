import { BillingDialog } from '@kittycad/ui-components'
import { CustomIcon } from '@src/components/CustomIcon'
import type { BillingContext } from '@src/lib/billing'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import { useState } from 'react'

interface HomeBillingReminderProps {
  userId: string
  billingContext: Pick<
    BillingContext,
    'balance' | 'allowance' | 'error' | 'userPaymentBalance'
  >
}

function getDismissedCycle(storageKey: string) {
  try {
    return window.localStorage.getItem(storageKey)
  } catch {
    return null
  }
}

export function HomeBillingReminder({
  userId,
  billingContext,
}: HomeBillingReminderProps) {
  const [dismissal, setDismissal] = useState<{
    userId: string
    cycle: string
  }>()
  const { balance, allowance, error, userPaymentBalance } = billingContext
  const refreshTime = Date.parse(
    userPaymentBalance?.monthly_api_credits_refresh_at ?? ''
  )

  if (
    error ||
    typeof balance !== 'number' ||
    !Number.isFinite(balance) ||
    typeof allowance !== 'number' ||
    !Number.isFinite(allowance) ||
    allowance <= 0 ||
    balance / allowance >= 0.1 ||
    !Number.isFinite(refreshTime)
  ) {
    return null
  }

  // The API advances this date only once the monthly credits refresh.
  const cycle = String(refreshTime)
  const storageKey = `zoo.homeBillingReminder.dismissed.${userId}`
  if (
    (dismissal?.userId === userId && dismissal.cycle === cycle) ||
    getDismissedCycle(storageKey) === cycle
  ) {
    return null
  }

  const dismiss = () => {
    setDismissal({ userId, cycle })
    try {
      window.localStorage.setItem(storageKey, cycle)
    } catch {}
  }

  return (
    <div className="relative my-2">
      <BillingDialog
        upgradeHref={withSiteBaseURL('/design-studio-pricing')}
        accountHref={withSiteBaseURL('/account/billing')}
        billingClick={openExternalBrowserIfDesktop()}
        {...billingContext}
        className="pr-9"
      />
      <button
        type="button"
        aria-label="Dismiss billing reminder"
        onClick={dismiss}
        className="absolute top-2 right-2 m-0 flex h-6 w-6 items-center justify-center rounded-sm border-none bg-transparent p-0 text-chalkboard-80 hover:text-chalkboard-100"
      >
        <CustomIcon name="close" className="h-4 w-4" />
      </button>
    </div>
  )
}
