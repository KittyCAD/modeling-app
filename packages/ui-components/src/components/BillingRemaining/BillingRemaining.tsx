import type { CustomerBalance, PaymentMethod } from '@kittycad/lib'
import { useEffect, useState } from 'react'
import { BillingIcon } from '../Billing/BillingIcon'
import { Spinner } from '../Billing/Spinner'
import '../Billing/Billing.css'
import type { BillingError } from '../../lib/billing'
import { classNames } from '../../lib/classNames'

export enum BillingRemainingMode {
  ProgressBarFixed = 0,
  ProgressBarStretch = 1,
}

export interface BillingRemainingProps {
  mode: BillingRemainingMode
  error?: BillingError
  balance?: number
  allowance?: number
  paymentMethods?: PaymentMethod[]
  userPaymentBalance?: CustomerBalance
}

function TotalDue({ amount }: { amount: string }) {
  return (
    <div
      className={classNames(
        'kc-billing-total-due',
        Number(amount) > 0 && 'kc-billing-total-due--overdue'
      )}
    >
      <div className="kc-billing-total-due__label">Overrun</div>
      <div className="kc-billing-total-due__amount">
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
      className="kc-billing-error"
      onMouseEnter={() => setShowMessage(true)}
      onMouseLeave={() => setShowMessage(false)}
    >
      {showMessage && (
        <div
          data-testid="billing-remaining-error-message"
          className="kc-billing-error__message"
        >
          <div className="kc-billing-error__message-inner">
            Error fetching billing: {error.error.type}
          </div>
        </div>
      )}
      <div
        data-testid="billing-remaining-error-indicator"
        className="kc-billing-error__indicator"
      >
        <BillingIcon name="exclamationMark" />
      </div>
    </div>
  )
}

function ProgressBar({ max, value }: { max: number; value: number }) {
  const ratio = value / max

  return (
    <div className="kc-billing-progress">
      <div
        data-testid="billing-remaining-progress-bar-inner"
        className="kc-billing-progress__inner"
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
    <Spinner className="kc-billing-spinner--inline" />
  ) : (
    <span>{getBalanceString(amount)}</span>
  )
}

export function BillingRemaining(props: BillingRemainingProps) {
  const isFlex = props.mode === BillingRemainingMode.ProgressBarStretch
  const hasPaymentMethod =
    props.paymentMethods !== undefined && props.paymentMethods.length > 0
  const totalDue = props.userPaymentBalance?.total_due ?? '0.00'
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
        'kc-billing-remaining',
        isFlex
          ? 'kc-billing-remaining--stretch'
          : 'kc-billing-remaining--fixed'
      )}
    >
      <div className="kc-billing-remaining__row">
        {props.error && <ErrorMsg error={props.error} />}
        <div className="kc-billing-remaining__meter-column">
          {!isFlex &&
            (typeof props.balance === 'number' ? (
              <div
                className="kc-billing-remaining__balance"
                data-testid="billing-balance"
              >
                <BillingBalance amount={props.balance} />
              </div>
            ) : (
              showSpinner && (
                <Spinner className="kc-billing-spinner--inline" />
              )
            ))}
          {props.balance !== Number.POSITIVE_INFINITY && (
            <div className="kc-billing-remaining__meter">
              <ProgressBar
                max={props.allowance ?? 1}
                value={props.balance ?? 0}
              />
            </div>
          )}
        </div>
        {!isFlex && (hasPaymentMethod || Number(totalDue.toString()) > 0) && (
          <TotalDue amount={totalDue.toString()} />
        )}
      </div>
      {isFlex && (
        <div className="kc-billing-remaining__summary">
          {typeof props.balance === 'number' ? (
            props.balance !== Number.POSITIVE_INFINITY ? (
              <>
                {getBalanceString(props.balance)} of Zookeeper reasoning time
                remaining this month
              </>
            ) : null
          ) : (
            <>
              {showSpinner && (
                <Spinner className="kc-billing-spinner--inline" />
              )}{' '}
              <span>Fetching remaining balance...</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}
