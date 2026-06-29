import type { CustomerBalance } from '@kittycad/lib'
import type { MouseEventHandler } from 'react'
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

  if (!hasUnlimited && hasTotalDue) {
    return (
      <div
        className={classNames(
          'box-border flex w-full flex-row justify-center gap-2 rounded-lg bg-ml-green p-4 text-xs leading-4 text-chalkboard-100',
          props.className
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-row gap-2">
            <div>
              <div className={iconShellClassName}>
                <BillingIcon name="exclamationMark" />
              </div>
            </div>
            <div className="text-chalkboard-90">
              To continue using Zoo's services, you must clear an unpaid total
              of <span className="font-bold">${totalDue}</span>.
            </div>
          </div>
          <a
            className={actionClassName}
            href={props.accountHref}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="billing-account-button"
            onClick={props.billingClick}
          >
            Go to billing
          </a>
        </div>
      </div>
    )
  }

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
            : props.text?.heading?.limited || defaultText.heading.limited}
        </div>
        <div className="text-chalkboard-80">
          {hasUnlimited
            ? props.text?.paragraph?.unlimited ||
              defaultText.paragraph.unlimited
            : props.text?.paragraph?.limited || defaultText.paragraph.limited}
        </div>
        <BillingRemaining
          mode={BillingRemainingMode.ProgressBarStretch}
          error={props.error}
          balance={props.balance}
          allowance={props.allowance}
        />
        {!hasUnlimited && (
          <a
            className={actionClassName}
            href={props.upgradeHref}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="billing-upgrade-button"
            onClick={props.billingClick}
          >
            {props.text?.button?.limited || defaultText.button.limited}
          </a>
        )}
      </div>
    </div>
  )
}
