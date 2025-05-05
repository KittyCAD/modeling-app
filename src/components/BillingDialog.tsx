import { IS_NIGHTLY } from '@src/routes/utils'
import { useSelector } from '@xstate/react'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import { CustomIcon } from '@src/components/CustomIcon'
import {
  BillingRemaining,
  BillingRemainingMode,
} from '@src/components/BillingRemaining'

import type { BillingActor } from '@src/machines/billingMachine'

export const BillingDialog = (props: { billingActor: BillingActor }) => {
  const billingContext = useSelector(
    props.billingActor,
    ({ context }) => context
  )
  const hasUnlimited = billingContext.credits === Infinity

  if (!IS_NIGHTLY) {
    return <></>
  }

  return (
    <div className="bg-ml-green fg-ml-black flex flex-row rounded-lg p-2 gap-2">
      <div>
        <div className="rounded bg-ml-black p-1">
          {hasUnlimited ? (
            <CustomIcon name="infinity" />
          ) : (
            <CustomIcon name="star" />
          )}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="font-bold font-lg text-ml-black">
          {hasUnlimited ? 'Unlimited Text-to-CAD' : 'Upgrade your plan'}
        </div>
        <div className="text-ml-grey">
          {hasUnlimited
            ? 'You have unlimited use on your paid plan.'
            : 'for unlimited usage of Text-to-CAD and more!'}
        </div>
        <BillingRemaining
          mode={BillingRemainingMode.ProgressBarStretch}
          billingActor={props.billingActor}
        />
        <a
          className="bg-ml-black text-ml-white rounded-lg text-center p-1 cursor-pointer"
          href="https://zoo.dev/account#upgrade"
          target="_blank"
          rel="noopener noreferrer"
          onClick={openExternalBrowserIfDesktop()}
        >
          Upgrade
        </a>
      </div>
    </div>
  )
}
