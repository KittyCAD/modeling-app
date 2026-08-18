import { ActionButton } from '@src/components/ActionButton'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import { isZookeeperBillingError } from '@src/lib/zookeeper/zookeeperBilling'

const terminalRecoveryButtonClassName =
  'h-7 w-fit !border-chalkboard-30 !bg-chalkboard-10 enabled:hover:!border-chalkboard-40 enabled:hover:!bg-chalkboard-20 disabled:!border-chalkboard-20 disabled:!bg-chalkboard-20/50 disabled:!text-chalkboard-60 focus-visible:outline-appForeground dark:!border-chalkboard-70 dark:!bg-chalkboard-90 dark:enabled:hover:!border-chalkboard-60 dark:enabled:hover:!bg-chalkboard-80 dark:disabled:!border-chalkboard-70 dark:disabled:!bg-chalkboard-90 dark:disabled:!text-chalkboard-40'

const billingButtonClassName =
  'h-7 w-fit !border-ml-green !bg-ml-green !text-chalkboard-100 hover:brightness-95 focus-visible:outline-appForeground'

export interface ZookeeperConnectionErrorBannerProps {
  connectionError?: string
  canClearChat?: boolean
  isClearingChat?: boolean
  onReconnect: () => void
  onClickClearChat: () => void
}

export function ZookeeperConnectionErrorBanner(
  props: ZookeeperConnectionErrorBannerProps
) {
  const isBillingError = isZookeeperBillingError(props.connectionError)

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
            {isBillingError
              ? "You're out of Zookeeper credits."
              : (props.connectionError ??
                'Zookeeper disconnected unexpectedly.')}
          </p>
          <p className="text-sm text-chalkboard-70 dark:text-chalkboard-30">
            {isBillingError
              ? 'Enable pay as you go or upgrade your plan to continue using Zookeeper.'
              : props.canClearChat
                ? 'Reconnect to try loading this conversation again.'
                : 'Reconnect to try connecting again.'}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {isBillingError && (
          <ActionButton
            Element="externalLink"
            aria-label="Upgrade"
            to={withSiteBaseURL('/account/billing')}
            className={billingButtonClassName}
            iconStart={{ icon: 'link', bgClassName: '!bg-transparent ml-1' }}
            rel="noreferrer"
            tabIndex={0}
          >
            Upgrade
          </ActionButton>
        )}
        <ActionButton
          Element="button"
          aria-label="Reconnect"
          type="button"
          className={terminalRecoveryButtonClassName}
          iconStart={{ icon: 'refresh', bgClassName: '!bg-transparent ml-1' }}
          onClick={props.onReconnect}
          disabled={props.isClearingChat}
          tabIndex={0}
        >
          Reconnect
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
