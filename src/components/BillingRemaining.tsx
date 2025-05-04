import { Spinner } from '@src/components/Spinner'
import { useSelector } from '@xstate/react'
import { useState } from 'react'

import { CustomIcon } from '@src/components/CustomIcon'
import type { BillingActor } from '@src/machines/billingMachine'

export enum BillingRemainingMode {
  ProgressBarFixed,
  ProgressBarStretch,
}

export interface BillingRemainingProps {
  mode: BillingRemainingMode
  billingActor: BillingActor
}

const Error = (props: { error: Error }) => {
  const [showMessage, setShowMessage] = useState(false)

  const fadedBg = 'rgba(127, 127, 127, 0.2)'
  const fadedFg = 'rgba(255, 255, 255, 0.6)'
  const colors = {
    color: fadedFg,
    stroke: fadedFg,
    fill: fadedFg,
    backgroundColor: fadedBg,
  }

  return (
    <div
      onMouseEnter={() => setShowMessage(true)}
      onMouseLeave={() => setShowMessage(false)}
    >
      {showMessage && (
        <div
          style={{
            position: 'absolute',
          }}
        >
          <div
            className="rounded p-1"
            style={{ ...colors, position: 'relative', top: -32 }}
          >
            {props.error.toString()}
          </div>
        </div>
      )}
      <div className="rounded" style={colors}>
        <CustomIcon name="exclamationMark" className="w-5 h-5" />
      </div>
    </div>
  )
}

const ProgressBar = (props: { max: number; value: number }) => {
  const ratio = props.value / props.max

  return (
    <div
      className="rounded w-full border-ml-black bg-ml-black"
      style={{
        height: 6,
        borderWidth: '1px',
        borderStyle: 'solid',
      }}
    >
      <div
        className="bg-ml-green"
        style={{
          width: Math.min(100, ratio * 100).toFixed(2) + '%',
          height: '100%',
          borderTopRightRadius: 4,
          borderBottomRightRadius: 4,
        }}
      ></div>
    </div>
  )
}

const BillingCredit = (props: { amount: number }) => {
  return props.amount === Infinity ? (
    <CustomIcon name="infinity" className="w-5 h-5" />
  ) : Number.isNaN(props.amount) || props.amount === undefined ? (
    <Spinner className="text-inherit w-4 h-4" />
  ) : (
    Math.max(0, Math.trunc(props.amount))
  )
}

export const BillingRemaining = (props: BillingRemainingProps) => {
  const billingContext = useSelector(
    props.billingActor,
    ({ context }) => context
  )

  const isFlex = props.mode === BillingRemainingMode.ProgressBarStretch
  const cssWrapper = [
    'bg-ml-green',
    'select-none',
    'cursor-pointer',
    'py-1',
    'rounded',
    '!no-underline',
    'font-semibold',
    'text-xs',
    '!text-chalkboard-100',
    'dark:!text-chalkboard-0',
  ]

  return (
    <div
      data-testid="billing-remaining"
      className={[isFlex ? 'flex flex-col gap-1' : 'px-2']
        .concat(cssWrapper)
        .join(' ')}
    >
      <div className="flex flex-row gap-2 items-center">
        {billingContext.error && <Error error={billingContext.error} />}
        {!isFlex && (
          <div className="font-mono">
            <BillingCredit amount={billingContext.credits} />
          </div>
        )}
        {10 !== Infinity && (
          <div className={[isFlex ? 'flex-grow' : 'w-16'].join(' ')}>
            <ProgressBar
              max={billingContext.allowance ?? 1}
              value={billingContext.credits ?? 0}
            />
          </div>
        )}
      </div>
      {isFlex && (
        <div className="flex flex-row gap-1">
          {billingContext.credits ? (
            <>{billingContext.credits} credits remaining this month</>
          ) : (
            <>
              <Spinner className="text-inherit w-4 h-4" />{' '}
              <span>Fetching remaining credits...</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}
