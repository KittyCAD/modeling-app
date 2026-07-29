import type { ReactNode } from 'react'

import { ActionButton } from '@src/components/ActionButton'
import { CustomIcon } from '@src/components/CustomIcon'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'

export const ZOO_STATUS_URL = 'https://status.zoo.dev'

export const ConnectionRecovery = ({
  title = 'Failed to connect.',
  description,
  onReconnect,
  reconnectDisabled,
  className,
  dataTestId = 'connection-recovery',
}: {
  title?: ReactNode
  description?: ReactNode
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
        className="h-8 w-8 shrink-0 text-destroy-60"
        aria-hidden={true}
        focusable="false"
      />
      <h2 className="mt-3 text-base font-normal text-destroy-60">{title}</h2>
      <hr className="mt-3 w-full max-w-[22rem] border-0 border-t border-chalkboard-30 dark:border-chalkboard-70" />
      <p className="mt-4 mb-3 w-full max-w-[22rem] text-base leading-tight text-chalkboard-70 dark:text-chalkboard-30">
        {description ?? (
          <>
            Click below to try again. If it persists,{' '}
            <a
              className="text-chalkboard-80 underline underline-offset-1 dark:text-chalkboard-10"
              href={ZOO_STATUS_URL}
              onClick={openExternalBrowserIfDesktop(ZOO_STATUS_URL)}
            >
              the problem may be on our side
            </a>
            .
          </>
        )}
      </p>
      <ActionButton
        className="h-6 focus-visible:outline-appForeground"
        Element="button"
        iconStart={{
          icon: 'refresh',
        }}
        onClick={onReconnect}
        disabled={reconnectDisabled}
        tabIndex={0}
      >
        Reconnect
      </ActionButton>
    </div>
  )
}
