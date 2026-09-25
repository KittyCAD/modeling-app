import type { CustomerBalance } from '@kittycad/lib'
import ms from 'ms'
import type { MouseEventHandler } from 'react'
import { useEffect, useState } from 'react'
import type { BillingError } from '../../lib/billing'
import { classNames } from '../../lib/classNames'
import type { DeepPartial } from '../../lib/types'
import { BillingIcon } from '../Billing/BillingIcon'
import {
  BillingRemaining,
  BillingRemainingMode,
} from '../BillingRemaining/BillingRemaining'

type TextProps = {
  heading: {
    unlimited: string
    limited: string
  }
  paragraph: {
    unlimited: string
    limited: string
  }
  button: {
    limited: string
  }
}

export type BillingDialogProps = {
  error?: BillingError
  balance?: number
  allowance?: number
  userPaymentBalance?: CustomerBalance
  upgradeHref: string
  accountHref: string
  text?: DeepPartial<TextProps>
  billingClick?: MouseEventHandler<HTMLAnchorElement>
  className?: string
}

const defaultText: TextProps = {
  heading: {
    unlimited: 'Unlimited Zookeeper',
    limited: 'Upgrade your plan',
  },
  paragraph: {
    unlimited: 'You have unlimited use on your paid plan.',
    limited: 'for unlimited usage of Zookeeper and more!',
  },
  button: {
    limited: 'Upgrade',
  },
}

const iconShellClassName =
  'flex h-7 w-7 flex-none items-center justify-center rounded bg-ml-black text-ml-white'
const actionClassName =
  'block cursor-pointer rounded-lg bg-ml-black px-2 py-1 text-center text-ml-white no-underline hover:brightness-110 hover:text-ml-white'

export function BillingDialog(props: BillingDialogProps) {
  const hasUnlimited = props.balance === Number.POSITIVE_INFINITY
  const totalDue = props.userPaymentBalance?.total_due ?? 0
  const hasTotalDue = Number(totalDue) > 0
  const totalDueString = Number(totalDue).toFixed(2)
  const refreshAt = props.userPaymentBalance?.monthly_api_credits_refresh_at
  const refreshTime = refreshAt ? Date.parse(refreshAt) : Number.NaN
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    if (!Number.isFinite(refreshTime)) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [refreshTime])

  return (
    <div
      className={classNames(
        'box-border flex w-full flex-row gap-2 rounded-lg bg-ml-green p-4 text-xs leading-4 text-chalkboard-100',
        props.className
      )}
    >
      <div>
        <div className={iconShellClassName}>
          {hasUnlimited ? (
            <BillingIcon name="infinity" />
          ) : (
            <BillingIcon name="star" />
          )}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="min-h-5 py-1 font-bold text-chalkboard-100">
          {hasUnlimited
            ? props.text?.heading?.unlimited || defaultText.heading.unlimited
            : hasTotalDue
              ? 'Zookeeper balance'
              : props.text?.heading?.limited || defaultText.heading.limited}
        </div>
        {!hasTotalDue && (
          <div className="text-chalkboard-80">
            {hasUnlimited
              ? props.text?.paragraph?.unlimited ||
                defaultText.paragraph.unlimited
              : props.text?.paragraph?.limited || defaultText.paragraph.limited}
          </div>
        )}
        <BillingRemaining
          mode={BillingRemainingMode.ProgressBarStretch}
          error={props.error}
          balance={props.balance}
          allowance={props.allowance}
        />
        {!props.error &&
          Number.isFinite(props.balance) &&
          (props.allowance ?? 0) > 0 &&
          Number.isFinite(refreshTime) && (
            <time dateTime={refreshAt} className="text-chalkboard-90">
              {refreshTime <= now
                ? 'Credit refresh pending'
                : `Credits refresh in ${ms(refreshTime - now, { long: true })}`}
            </time>
          )}
        {hasTotalDue && (
          <div className="text-chalkboard-90">
            <div>
              Recorded charges:{' '}
              <span className="font-bold">${totalDueString}</span>
            </div>
            <p className="mt-1">
              Recorded charges do not mean your credits are exhausted. Available
              credits may apply when usage is invoiced. See billing for invoice
              details.
            </p>
          </div>
        )}
        {(hasTotalDue || !hasUnlimited) && (
          <a
            className={actionClassName}
            href={hasTotalDue ? props.accountHref : props.upgradeHref}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={
              hasTotalDue ? 'billing-account-button' : 'billing-upgrade-button'
            }
            onClick={props.billingClick}
          >
            {hasTotalDue
              ? 'Go to billing'
              : props.text?.button?.limited || defaultText.button.limited}
          </a>
        )}
      </div>
    </div>
  )
}
