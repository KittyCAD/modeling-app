import type { ReactNode } from 'react'

import { ActionButton } from '@src/components/ActionButton'
import { CustomIcon } from '@src/components/CustomIcon'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'

export const DIAGNOSING_NETWORK_ISSUES_URL =
  'https://community.zoo.dev/t/diagnosing-network-connection-issues/156'

export const ConnectionRecovery = ({
  title = 'Failed to connect.',
  onReconnect,
  reconnectDisabled,
  className,
  dataTestId = 'connection-recovery',
}: {
  title?: ReactNode
  onReconnect: () => void
  reconnectDisabled?: boolean
  className?: string
  dataTestId?: string
}) => {
  return (
    <div
      className={`flex min-w-0 max-w-full flex-col items-center justify-center overflow-y-auto px-4 py-6 text-center text-chalkboard-80 dark:text-chalkboard-20 ${className ?? ''}`}
      data-testid={dataTestId}
      role="alert"
    >
      <CustomIcon
        name="close"
        className="h-8 w-8 rounded-full bg-destroy-60 !text-chalkboard-10"
      />
      <p className="mt-4 text-base text-destroy-60">{title}</p>
      <div className="mt-2 mb-2 w-full max-w-xl px-4 pt-2 pb-6 text-base">
        Click below to try again. If it persists, please visit the community
        support thread on{' '}
        <a
          className="contents text-chalkboard-80 dark:text-chalkboard-10"
          href={DIAGNOSING_NETWORK_ISSUES_URL}
          onClick={openExternalBrowserIfDesktop(DIAGNOSING_NETWORK_ISSUES_URL)}
        >
          <span className="underline underline-offset-1">
            diagnosing network connection issues
          </span>
        </a>
        .
      </div>
      <ActionButton
        className="h-5"
        Element="button"
        iconStart={{
          icon: 'refresh',
        }}
        onClick={onReconnect}
        disabled={reconnectDisabled}
        tabIndex={0}
      >
        reconnect
      </ActionButton>
    </div>
  )
}
