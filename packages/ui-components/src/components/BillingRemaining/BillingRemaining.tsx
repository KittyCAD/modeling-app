import type { CustomerBalance } from '@kittycad/lib'
import { useEffect, useState } from 'react'
import type { BillingError } from '../../lib/billing'
import { classNames } from '../../lib/classNames'
import { BillingIcon } from '../Billing/BillingIcon'
import { Spinner } from '../Billing/Spinner'

export enum BillingRemainingMode {
  ProgressBarFixed = 0,
  ProgressBarStretch = 1,
}

export interface BillingRemainingProps {
  mode: BillingRemainingMode
  error?: BillingError
  balance?: number
  allowance?: number
  userPaymentBalance?: CustomerBalance
}

function TotalDue({ amount }: { amount: string }) {
  return (
    <div
      className={classNames(
        'flex flex-none flex-col leading-none',
        Number(amount) > 0 ? 'text-red-500' : 'text-chalkboard-90'
      )}
    >
      <div className="border-t border-ml-black text-[0.9em] text-chalkboard-90">
        Overrun
      </div>
      <div className="pt-[0.1em] font-mono text-[0.95em] tracking-normal">
        <span>$</span>
        <span>{amount}</span>
      </div>
    </div>
  )
}

function ErrorMsg({ error }: { error: BillingError }) {
  const [showMessage, setShowMessage] = useState(false)

  return (
    <div
      className="relative flex-none"
      onMouseEnter={() => setShowMessage(true)}
      onMouseLeave={() => setShowMessage(false)}
    >
      {showMessage && (
        <div
          data-testid="billing-remaining-error-message"
          className="absolute bottom-[calc(100%+0.5rem)] left-1/2 z-[1] w-max max-w-64 -translate-x-1/2"
        >
          <div className="rounded bg-black/25 p-1 text-white/75">
            Error fetching billing: {error.error.type}
          </div>
        </div>
      )}
      <div
        data-testid="billing-remaining-error-indicator"
        className="rounded bg-black/25 text-white/75"
      >
        <BillingIcon name="exclamationMark" />
      </div>
    </div>
  )
}

function ProgressBar({ max, value }: { max: number; value: number }) {
  const ratio = value / max

  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full border border-ml-black bg-ml-black">
      <div
        data-testid="billing-remaining-progress-bar-inner"
        className="h-full rounded-full bg-ml-green"
        style={{
          width: `${Math.min(100, ratio * 100).toFixed(2)}%`,
        }}
      />
    </div>
  )
}

function getBalanceString(amount: number) {
  if (0 < amount && amount < 1) {
    return '< 1 min'
  }

  return `${Math.floor(amount)} min`
}

function getCurrencyAmountString(amount: number | string) {
  const value = Number(amount)

  return Number.isFinite(value) ? value.toFixed(2) : amount.toString()
}

function BillingBalance({ amount }: { amount: number }) {
  const [showSpinner, setShowSpinner] = useState<boolean>(true)

  useEffect(() => {
    const id = setTimeout(() => {
      setShowSpinner(false)
    }, 5000)

    return () => {
      clearTimeout(id)
    }
  }, [])

  return amount === Number.POSITIVE_INFINITY ? (
    <BillingIcon data-testid="infinity" name="infinity" />
  ) : showSpinner && (Number.isNaN(amount) || amount === undefined) ? (
    <Spinner className="h-4 w-4 text-inherit" />
  ) : (
    <span>{getBalanceString(amount)}</span>
  )
}

export function BillingRemaining(props: BillingRemainingProps) {
  const isFlex = props.mode === BillingRemainingMode.ProgressBarStretch
  const totalDue = props.userPaymentBalance?.total_due ?? 0
  const totalDueString = getCurrencyAmountString(totalDue)
  const hasOverrun = Number(totalDue) > 0
  const [showSpinner, setShowSpinner] = useState<boolean>(true)

  useEffect(() => {
    const id = setTimeout(() => {
      setShowSpinner(false)
    }, 5000)

    return () => {
      clearTimeout(id)
    }
  }, [])

  return (
    <div
      data-testid="billing-remaining"
      className={classNames(
        'box-border cursor-pointer select-none bg-ml-green text-xs leading-4 !text-chalkboard-100 !no-underline',
        isFlex ? 'flex w-full flex-col gap-1' : 'flex h-full items-stretch px-2'
      )}
    >
      <div className="flex min-w-0 flex-row items-center justify-center gap-2">
        {props.error && <ErrorMsg error={props.error} />}
        <div
          className={classNames(
            'flex min-w-0 w-full flex-col',
            !isFlex && 'items-center'
          )}
        >
          {!isFlex &&
            (typeof props.balance === 'number' ? (
              <div
                className="whitespace-nowrap px-1 font-mono"
                data-testid="billing-balance"
              >
                <BillingBalance amount={props.balance} />
              </div>
            ) : (
              showSpinner && <Spinner className="h-4 w-4 text-inherit" />
            ))}
          {props.balance !== Number.POSITIVE_INFINITY && (
            <div
              className={classNames(
                'w-full',
                isFlex ? 'flex-grow' : 'min-w-10'
              )}
            >
              <ProgressBar
                max={props.allowance ?? 1}
                value={props.balance ?? 0}
              />
            </div>
          )}
        </div>
        {!isFlex && hasOverrun && <TotalDue amount={totalDueString} />}
      </div>
      {isFlex && (
        <div className="flex min-w-0 flex-row items-center gap-1 text-chalkboard-90">
          {typeof props.balance === 'number' ? (
            props.balance !== Number.POSITIVE_INFINITY ? (
              <>
                {getBalanceString(props.balance)} of Zookeeper reasoning time
                remaining this month
              </>
            ) : null
          ) : (
            <>
              {showSpinner && <Spinner className="h-4 w-4 text-inherit" />}{' '}
              <span>Fetching remaining balance...</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}
