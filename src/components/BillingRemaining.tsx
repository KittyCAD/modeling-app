import { useSelector } from '@xstate/react'
import { useState } from 'react'

import { CustomIcon } from '@src/components/CustomIcon'
import { billingActor } from '@src/lib/singletons'

export enum BillingRemainingMode {
  ProgressBarFixed,
  ProgressBarStretch,
}

export interface BillingRemainingProps {
  mode: BillingRemainingMode
}

const Error = (props: { error: Error }) => {
  const [showMessage, setShowMessage] = useState(false)

  const fadedBg = "rgba(127, 127, 127, 0.2)"
  const fadedFg = "rgba(255, 255, 255, 0.6)"
  const colors = { color: fadedFg, stroke: fadedFg, fill: fadedFg, backgroundColor: fadedBg } 

  return <div
    onMouseEnter={() => setShowMessage(true)}
    onMouseLeave={() => setShowMessage(false)}
  >
    { showMessage && <div style={{ 
      position: "absolute",
    }}>
      <div className="rounded p-1" style={{ ...colors, position: "relative", top: -32 }}>
        { props.error.toString() }
      </div>
    </div> }
    <div
      className="rounded"
      style={colors}
    ><CustomIcon name="exclamationMark"  className="w-5 h-5" />
    </div>
  </div>
}

const ProgressBar = (props: { max: number, value: number }) => {
  const ratio = props.value / props.max

  return <div
  className="rounded w-full"
  style={{
    height: 6,
    backgroundColor: "transparent",
    border: "1px solid black",
  }}>
    <div style={{
      backgroundColor: "black",
      width: (ratio * 100).toFixed(2) + "%",
      height: "100%",
      borderTopRightRadius: 4,
      borderBottomRightRadius: 4,
    }}></div>
  </div>
}

const BillingCredit = (props: { amount: number }) => {
  return props.amount === Infinity
  ? <CustomIcon name="booleanUnion" className="w-5 h-5" />
  : Number.isNaN(props.amount) || props.amount === undefined
  ? '?'
  : Math.max(0, Math.trunc(props.amount))
}

export const BillingRemaining = (props: BillingRemainingProps) => {
  const billingContext = useSelector(billingActor, ({ context }) => context)

  const isFlex = props.mode === BillingRemainingMode.ProgressBarStretch
  const cssWrapper = [
    'select-none',
    'cursor-pointer',
    'py-1',
    'px-2',
    'rounded',
    '!no-underline',
    'font-semibold',
    'text-xs',
    '!text-chalkboard-100',
    'dark:!text-chalkboard-0',
  ]

  return <div
    data-testid="billing-remaining"
    style={{backgroundColor: "#29FFA4"}}
    className={[isFlex ? "flex flex-col" : ""].concat(cssWrapper).join(" ")}>
    <div className="flex flex-row gap-2 items-center">
      { billingContext.error && <Error error={billingContext.error} /> }
      <BillingCredit amount={ billingContext.credits } />
      { 10 !== Infinity  &&
      <div className={[isFlex ? "flex-grow" : "w-16"].join(" ")}>
        <ProgressBar max={billingContext.allowance} value={billingContext.credits} />
      </div> }
    </div>
    { isFlex && <div>
      { billingContext.credits
        ? <>{ billingContext.credits } credits remaining this month</>
        : <>Unable to fetch remaining credits</>
      }
     </div> }
  </div>
}
