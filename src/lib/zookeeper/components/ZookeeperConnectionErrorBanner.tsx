import type { MlCopilotAccessDeniedCode } from '@kittycad/lib'
import { ActionButton } from '@src/components/ActionButton'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import type { MouseEventHandler } from 'react'

const terminalRecoveryButtonClassName =
  'h-7 w-fit !border-chalkboard-30 !bg-chalkboard-10 enabled:hover:!border-chalkboard-40 enabled:hover:!bg-chalkboard-20 disabled:!border-chalkboard-20 disabled:!bg-chalkboard-20/50 disabled:!text-chalkboard-60 focus-visible:outline-appForeground dark:!border-chalkboard-70 dark:!bg-chalkboard-90 dark:enabled:hover:!border-chalkboard-60 dark:enabled:hover:!bg-chalkboard-80 dark:disabled:!border-chalkboard-70 dark:disabled:!bg-chalkboard-90 dark:disabled:!text-chalkboard-40'

const billingButtonClassName =
  'h-7 w-fit !border-ml-green !bg-ml-green !text-chalkboard-100 hover:brightness-95 focus-visible:outline-appForeground'

export interface ZookeeperConnectionErrorBannerProps {
  connectionError?: string
  accessDeniedCode?: MlCopilotAccessDeniedCode
  canClearChat?: boolean
  isClearingChat?: boolean
  isCheckingBilling?: boolean
  onReconnect: () => void
  onCheckBilling?: () => void
  onOpenBilling?: () => void
  onClickClearChat: () => void
}

type BillingRecoveryContent = {
  title: string
  description: string
  actionLabel: string
  actionUrl: string
}

const BILLING_URL = withSiteBaseURL('/account/billing')
const SUPPORT_URL = 'https://community.zoo.dev/'

const BILLING_RECOVERY_CONTENT: Record<
  MlCopilotAccessDeniedCode,
  BillingRecoveryContent
> = {
  pay_as_you_go_disabled: {
    title: "You're out of Zookeeper credits.",
    description: 'Enable pay as you go or upgrade your plan to continue.',
    actionLabel: 'Manage billing',
    actionUrl: BILLING_URL,
  },
  missing_payment_method: {
    title: 'Add a payment method to continue.',
    description: 'Zookeeper needs a valid payment method for additional usage.',
    actionLabel: 'Add payment method',
    actionUrl: BILLING_URL,
  },
  payment_method_failed: {
    title: 'Your payment needs attention.',
    description: 'Update or confirm your payment method, then check again.',
    actionLabel: 'Update payment',
    actionUrl: BILLING_URL,
  },
  billing_threshold_reached: {
    title: 'An outstanding invoice needs payment.',
    description: 'Pay the invoice in Billing, then check again.',
    actionLabel: 'Open billing',
    actionUrl: BILLING_URL,
  },
  upgrade_downgrade_abuse: {
    title: 'Plan changes temporarily locked.',
    description: 'Contact Zoo support for help restoring account access.',
    actionLabel: 'Contact support',
    actionUrl: SUPPORT_URL,
  },
  admin: {
    title: 'Your account is blocked.',
    description: 'Contact Zoo support to restore Zookeeper access.',
    actionLabel: 'Contact support',
    actionUrl: SUPPORT_URL,
  },
}

export function ZookeeperConnectionErrorBanner(
  props: ZookeeperConnectionErrorBannerProps
) {
  const billingRecovery = props.accessDeniedCode
    ? BILLING_RECOVERY_CONTENT[props.accessDeniedCode]
    : undefined
  const isBillingError = billingRecovery !== undefined
  const handleBillingAction: MouseEventHandler<HTMLAnchorElement> = (event) => {
    if (billingRecovery?.actionUrl === BILLING_URL) {
      props.onOpenBilling?.()
    }
    void openExternalBrowserIfDesktop(billingRecovery?.actionUrl)(event)
  }

  return (
    <div
      className={`m-4 flex flex-col gap-3 rounded-md border p-4 text-left ${
        isBillingError
          ? 'border-ml-green bg-ml-green/10 dark:border-ml-green dark:bg-ml-green/10'
          : 'border-destroy-30 bg-destroy-10 dark:border-destroy-70 dark:bg-destroy-80/20'
      }`}
      role="alert"
    >
      <div className="flex items-start gap-2">
        <div className="flex flex-col gap-1">
          <p className="font-semibold">
            {billingRecovery
              ? billingRecovery.title
              : (props.connectionError ??
                'Zookeeper disconnected unexpectedly.')}
          </p>
          <p className="text-sm text-chalkboard-70 dark:text-chalkboard-30">
            {billingRecovery
              ? billingRecovery.description
              : props.canClearChat
                ? 'Reconnect to try loading this conversation again.'
                : 'Reconnect to try connecting again.'}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {billingRecovery && (
          <ActionButton
            Element="externalLink"
            aria-label={billingRecovery.actionLabel}
            to={billingRecovery.actionUrl}
            className={billingButtonClassName}
            iconStart={{ icon: 'link', bgClassName: '!bg-transparent ml-1' }}
            onClick={handleBillingAction}
            rel="noreferrer"
            tabIndex={0}
          >
            {billingRecovery.actionLabel}
          </ActionButton>
        )}
        <ActionButton
          Element="button"
          aria-label={
            isBillingError
              ? props.isCheckingBilling
                ? 'Checking...'
                : 'Check again'
              : 'Reconnect'
          }
          type="button"
          className={terminalRecoveryButtonClassName}
          iconStart={{ icon: 'refresh', bgClassName: '!bg-transparent ml-1' }}
          onClick={
            isBillingError
              ? (props.onCheckBilling ?? props.onReconnect)
              : props.onReconnect
          }
          disabled={props.isClearingChat || props.isCheckingBilling}
          tabIndex={0}
        >
          {isBillingError
            ? props.isCheckingBilling
              ? 'Checking...'
              : 'Check again'
            : 'Reconnect'}
        </ActionButton>
      </div>
      {!isBillingError && props.canClearChat && (
        <div className="flex flex-col gap-2 border-t border-destroy-30 pt-3 dark:border-destroy-70">
          <p className="text-sm text-chalkboard-70 dark:text-chalkboard-30">
            If reconnecting still does not work, clearing the chat is a last
            resort. Previous conversation data will no longer be visible in this
            pane.
          </p>
          <ActionButton
            Element="button"
            aria-label={props.isClearingChat ? 'Clearing...' : 'Clear chat'}
            type="button"
            className={`${terminalRecoveryButtonClassName} !text-destroy-80 dark:!text-destroy-20`}
            iconStart={{ icon: 'trash', bgClassName: '!bg-transparent ml-1' }}
            onClick={props.onClickClearChat}
            disabled={props.isClearingChat}
            tabIndex={0}
          >
            {props.isClearingChat ? 'Clearing...' : 'Clear chat'}
          </ActionButton>
        </div>
      )}
    </div>
  )
}
