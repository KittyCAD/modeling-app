import { Popover } from '@headlessui/react'

import { billingActor, useLayout } from '@src/lib/singletons'
import Tooltip from '@src/components/Tooltip'
import { DefaultLayoutPaneID, getOpenPanes } from '@src/lib/layout'
import type { BillingContext } from '@src/machines/billingMachine'
import {
  BillingDialog,
  BillingRemaining,
  BillingRemainingMode,
} from '@kittycad/react-shared'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import { useSelector } from '@xstate/react'

function BillingStatusBarItem(props: { billingContext: BillingContext }) {
  return (
    <Popover className="relative flex items-stretch">
      <Popover.Button
        className="m-0 p-0 border-0 flex items-stretch"
        data-testid="billing-remaining-bar"
      >
        <BillingRemaining
          mode={BillingRemainingMode.ProgressBarFixed}
          error={props.billingContext.error}
          credits={props.billingContext.credits}
          allowance={props.billingContext.allowance}
        />
        {!props.billingContext.error && (
          <Tooltip
            position="left"
            contentClassName="text-xs"
            hoverOnly
            wrapperClassName="ui-open:!hidden"
          >
            Zookeeper credits
          </Tooltip>
        )}
      </Popover.Button>
      <Popover.Panel className="absolute right-0 bottom-full mb-1 w-64 flex flex-col gap-1 align-stretch rounded-lg shadow-lg text-sm">
        <BillingDialog
          upgradeHref={withSiteBaseURL('/design-studio-pricing')}
          upgradeClick={openExternalBrowserIfDesktop()}
          error={props.billingContext.error}
          credits={props.billingContext.credits}
          allowance={props.billingContext.allowance}
        />
      </Popover.Panel>
    </Popover>
  )
}

export function ZookeeperCreditsMenu() {
  const billingContext = useSelector(billingActor, (actor) => {
    return actor.context
  })
  const layout = useLayout()
  return getOpenPanes({ rootLayout: layout }).includes(
    DefaultLayoutPaneID.TTC
  ) ? (
    <BillingStatusBarItem billingContext={billingContext} />
  ) : null
}
