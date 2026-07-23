import { Popover } from '@headlessui/react'

import {
  BillingDialog,
  BillingRemaining,
  BillingRemainingMode,
} from '@kittycad/ui-components'
import { defaultStatusBarItemClassNames } from '@src/components/StatusBar/StatusBar'
import Tooltip from '@src/components/Tooltip'
import {
  type BillingContext,
  getEstimatedBillingBalance,
} from '@src/lib/billing'
import { useApp } from '@src/lib/boot'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import { useEffect, useState } from 'react'

const BILLING_BALANCE_TICK_MS = 1000

function useEstimatedBillingBalance(billingContext: BillingContext) {
  const [now, setNow] = useState(Date.now())
  const shouldTick = billingContext.usageStartedAt !== undefined

  useEffect(() => {
    if (!shouldTick) {
      return
    }

    setNow(Date.now())
    const id = setInterval(() => {
      setNow(Date.now())
    }, BILLING_BALANCE_TICK_MS)

    return () => {
      clearInterval(id)
    }
  }, [shouldTick])

  return getEstimatedBillingBalance(billingContext, now)
}

function BillingStatusBarItem(props: { billingContext: BillingContext }) {
  const openBillingLinkExternally = openExternalBrowserIfDesktop()
  const displayedBalance = useEstimatedBillingBalance(props.billingContext)

  return (
    <Popover className="relative flex items-stretch">
      <Popover.Button
        className={`${defaultStatusBarItemClassNames} m-0 !p-0 flex items-stretch`}
        data-testid="billing-remaining-bar"
      >
        <BillingRemaining
          mode={BillingRemainingMode.ProgressBarFixed}
          error={props.billingContext.error}
          balance={displayedBalance}
          allowance={props.billingContext.allowance}
          userPaymentBalance={props.billingContext.userPaymentBalance}
        />
        {!props.billingContext.error && (
          <Tooltip
            position="top"
            contentClassName="text-xs"
            hoverOnly
            wrapperClassName="ui-open:!hidden"
          >
            Zoo balance
          </Tooltip>
        )}
      </Popover.Button>
      <Popover.Panel className="absolute right-0 bottom-full mb-1 w-64 flex flex-col gap-1 align-stretch rounded-lg shadow-lg text-sm">
        <BillingDialog
          upgradeHref={withSiteBaseURL('/design-studio-pricing')}
          accountHref={withSiteBaseURL('/account/billing')}
          billingClick={openBillingLinkExternally}
          error={props.billingContext.error}
          balance={displayedBalance}
          allowance={props.billingContext.allowance}
          userPaymentBalance={props.billingContext.userPaymentBalance}
        />
      </Popover.Panel>
    </Popover>
  )
}

export function ZookeeperCreditsMenu() {
  const { billing } = useApp()
  const billingContext = billing.useContext()
  return <BillingStatusBarItem billingContext={billingContext} />
}
