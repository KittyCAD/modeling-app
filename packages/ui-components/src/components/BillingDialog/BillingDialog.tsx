import type { CustomerBalance } from '@kittycad/lib'
import type { MouseEventHandler } from 'react'
import { BillingIcon } from '../Billing/BillingIcon'
import {
  BillingRemaining,
  BillingRemainingMode,
} from '../BillingRemaining/BillingRemaining'
import '../Billing/Billing.css'
import type { BillingError } from '../../lib/billing'
import { classNames } from '../../lib/classNames'
import { paths } from '../../lib/consts'
import type { DeepPartial } from '../../lib/types'

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
  text?: DeepPartial<TextProps>
  upgradeClick?: MouseEventHandler<HTMLAnchorElement>
  className?: string
}

const defaultProps: BillingDialogProps = {
  upgradeHref: paths.ZOO_UPGRADE,
  text: {
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
  },
}

export function BillingDialog(props: BillingDialogProps) {
  const hasUnlimited = props.balance === Number.POSITIVE_INFINITY
  const totalDue = props.userPaymentBalance?.total_due

  if (!hasUnlimited && totalDue) {
    return (
      <div
        className={classNames(
          'kc-billing-dialog',
          'kc-billing-dialog--centered',
          props.className
        )}
      >
        <div className="kc-billing-dialog__content">
          <div className="kc-billing-dialog__row">
            <div>
              <div className="kc-billing-dialog__icon-shell">
                <BillingIcon name="exclamationMark" />
              </div>
            </div>
            <div className="kc-billing-dialog__overdue">
              To continue using Zoo's services, you must clear an unpaid total
              of{' '}
              <span className="kc-billing-weight-bold">${totalDue}</span>.
            </div>
          </div>
          <a
            className="kc-billing-dialog__action"
            href={`${paths.ZOO_ACCOUNT}/billing`}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="billing-account-button"
          >
            Go to billing
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className={classNames('kc-billing-dialog', props.className)}>
      <div>
        <div className="kc-billing-dialog__icon-shell">
          {hasUnlimited ? (
            <BillingIcon name="infinity" />
          ) : (
            <BillingIcon name="star" />
          )}
        </div>
      </div>
      <div className="kc-billing-dialog__content">
        <div className="kc-billing-dialog__title">
          {hasUnlimited
            ? props.text?.heading?.unlimited ||
              defaultProps.text?.heading?.unlimited
            : props.text?.heading?.limited ||
              defaultProps.text?.heading?.limited}
        </div>
        <div className="kc-billing-dialog__body">
          {hasUnlimited
            ? props.text?.paragraph?.unlimited ||
              defaultProps.text?.paragraph?.unlimited
            : props.text?.paragraph?.limited ||
              defaultProps.text?.paragraph?.limited}
        </div>
        <BillingRemaining
          mode={BillingRemainingMode.ProgressBarStretch}
          error={props.error}
          balance={props.balance}
          allowance={props.allowance}
        />
        {!hasUnlimited && (
          <a
            className="kc-billing-dialog__action"
            href={props.upgradeHref || defaultProps.upgradeHref}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="billing-upgrade-button"
            onClick={props.upgradeClick}
          >
            {props.text?.button?.limited || defaultProps.text?.button?.limited}
          </a>
        )}
      </div>
    </div>
  )
}
