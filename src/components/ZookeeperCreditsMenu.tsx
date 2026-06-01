import { Popover } from '@headlessui/react'

import {
  BillingDialog,
  BillingRemaining,
  BillingRemainingMode,
} from '@kittycad/react-shared'
import { defaultStatusBarItemClassNames } from '@src/components/StatusBar/StatusBar'
import Tooltip from '@src/components/Tooltip'
import { useApp } from '@src/lib/boot'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import type { BillingContext } from '@src/machines/billingMachine'

function BillingStatusBarItem(props: { billingContext: BillingContext }) {
  return (
    <Popover className="relative flex items-stretch">
      <Popover.Button
        className={`${defaultStatusBarItemClassNames} m-0 !p-0 flex items-stretch`}
        data-testid="billing-remaining-bar"
      >
        <BillingRemaining
          mode={BillingRemainingMode.ProgressBarFixed}
          error={props.billingContext.error}
          balance={props.billingContext.balance}
          allowance={props.billingContext.allowance}
          paymentMethods={props.billingContext.paymentMethods}
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
          upgradeClick={openExternalBrowserIfDesktop()}
          error={props.billingContext.error}
          balance={props.billingContext.balance}
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
