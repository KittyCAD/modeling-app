import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { CustomIcon } from '@src/components/CustomIcon'
import { Spinner } from '@src/components/Spinner'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'

import { CONNECTION_ERROR_TEXT, ConnectionError } from '@src/network/utils'
import type { IErrorType } from '@src/network/utils'

import { ActionButton } from '@src/components/ActionButton'

interface LoadingProps extends React.PropsWithChildren {
  isDummy?: boolean
  isCompact?: boolean
  className?: string
  dataTestId?: string
  retryAttemptCountdown?: number
  isRetrying?: boolean
  showManualConnect?: boolean
  callback?: () => void
}

const statusUrl = 'https://status.zoo.dev'
const diagnosingNetworkIssuesUrl =
  'https://community.zoo.dev/t/diagnosing-network-connection-issues/156'

// This exists here and not in engineConnection because we want some styling
// available to us.
export const CONNECTION_ERROR_CALL_TO_ACTION_TEXT: Record<
  ConnectionError,
  ReactNode
> = {
  [ConnectionError.Unset]: '',
  [ConnectionError.LongLoadingTime]:
    'Connecting is taking longer than expected, check your network connection.',
  [ConnectionError.VeryLongLoadingTime]:
    'Check the connection is being blocked by a firewall, or if your internet is disconnected.',
  [ConnectionError.ICENegotiate]:
    'The modeling session was created, but there is an issue connecting to the stream.',
  [ConnectionError.DataChannelError]:
    'A modeling session was created, but there was an issue creating a modeling commands channel.',
  [ConnectionError.WebSocketError]:
    "An unexpected issue regarding the connection to Zoo's KittyCAD API happened. Design Studio will try to reconnect.",
  [ConnectionError.LocalDescriptionInvalid]:
    'The modeling session was created, but there is an issue connecting to the stream.',
  [ConnectionError.MissingAuthToken]:
    'Your authorization token is missing; please login again.',
  [ConnectionError.BadAuthToken]:
    'Your authorization token is invalid; please login again.',
  [ConnectionError.TooManyConnections]:
    'There are too many open engine connections associated with your account. Please close web browser windows and tabs with app.zoo.dev open, and close multiple Zoo Design Studio windows.',
  [ConnectionError.Outage]: (
    <>
      We seem to be experiencing an outage. Please visit{' '}
      <a href={statusUrl} onClick={openExternalBrowserIfDesktop(statusUrl)}>
        status.zoo.dev
      </a>{' '}
      for updates.
    </>
  ),
  [ConnectionError.PeerConnectionRemoteDisconnected]:
    'The remote end has disconnected. Zoo Design Studio will reconnect you.',
  [ConnectionError.Unknown]:
    'An unexpected error occurred. Please report this to us.',
}

const Loading = ({
  isDummy,
  isCompact,
  children,
  className,
  dataTestId,
  retryAttemptCountdown,
  isRetrying,
  showManualConnect,
  callback,
}: LoadingProps) => {
  const [error, setError] = useState<IErrorType>({
    error: ConnectionError.Unset,
  })
  const [countdown, setCountdown] = useState<undefined | number>(
    isRetrying && retryAttemptCountdown !== undefined
      ? Math.trunc(retryAttemptCountdown / 1000)
      : undefined
  )
  const [timeoutIdCountdown, setTimeoutIdCountdown] = useState<
    ReturnType<typeof setTimeout> | undefined
  >(undefined)

  const isUnrecoverableError = error.error > ConnectionError.VeryLongLoadingTime
  const colorClass =
    error.error === ConnectionError.Unset
      ? 'text-primary'
      : !isUnrecoverableError
        ? 'text-warn-60'
        : 'text-chalkboard-60 dark:text-chalkboard-40'

  useEffect(() => {
    if (retryAttemptCountdown === undefined) return

    setCountdown(Math.trunc(retryAttemptCountdown / 1000))
  }, [retryAttemptCountdown])

  useEffect(() => {
    if (countdown === undefined || countdown < 0) return

    clearTimeout(timeoutIdCountdown)
    setTimeoutIdCountdown(
      setTimeout(() => {
        setCountdown(countdown - 1)
      }, 1000)
    )
    return () => {
      clearTimeout(timeoutIdCountdown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [countdown])

  useEffect(() => {
    // Don't set long loading time if there's a more severe error
    if (isUnrecoverableError) return

    const shorterTimer = setTimeout(() => {
      setError({ error: ConnectionError.LongLoadingTime })
    }, 4000)
    const longerTimer = setTimeout(() => {
      setError({ error: ConnectionError.VeryLongLoadingTime })
    }, 7000)

    return () => {
      clearTimeout(shorterTimer)
      clearTimeout(longerTimer)
    }
  }, [error, setError, isUnrecoverableError])

  // Useful for particular cases where we want a loading spinner but no other
  // logic, such as when the feature tree is being built.
  if (isDummy) {
    return (
      <div
        className={`flex ${isCompact ? 'flex-row gap-2' : 'flex-col'} items-center justify-center ${colorClass} ${className}`}
        data-testid={dataTestId ? dataTestId : 'loading'}
      >
        <Spinner className={isCompact ? 'w-4 h-4' : 'w-8 w-8'} />
        <p className={`text-base ${isCompact ? '' : 'mt-4'}`}>{children}</p>
      </div>
    )
  }

  return (
    <div
      className={`body-bg flex flex-col items-center justify-center ${colorClass} ${className}`}
      data-testid={dataTestId ? dataTestId : 'loading'}
    >
      {isUnrecoverableError || showManualConnect ? (
        <CustomIcon
          name="close"
          className="w-8 h-8 !text-chalkboard-10 bg-destroy-60 rounded-full"
        />
      ) : (
        <Spinner />
      )}

      <p className={`text-base mt-4`}>
        {isUnrecoverableError || showManualConnect ? '' : children || 'Loading'}
      </p>

      {showManualConnect && (
        <>
          <p className="text-destroy-60">Failed to connect.</p>
          <div>
            <div className="inline-block max-w-3xl text-base gap-2 px-32 pt-2 mt-2 pb-6 mb-2 text-chalkboard-80 dark:text-chalkboard-20">
              Click below to try again. If it persists, please visit the
              community support thread on{' '}
              <a
                className="contents text-chalkboard-80 dark:text-chalkboard-10"
                href={diagnosingNetworkIssuesUrl}
                onClick={openExternalBrowserIfDesktop(
                  diagnosingNetworkIssuesUrl
                )}
              >
                <span className="underline underline-offset-1">
                  diagnosing network connection issues
                </span>
              </a>
              .
            </div>
          </div>
          <ActionButton
            className="h-5"
            Element="button"
            iconStart={{
              icon: 'refresh',
            }}
            onClick={() => {
              if (callback) {
                callback()
              }
            }}
          >
            reconnect
          </ActionButton>
        </>
      )}

      <div
        className={
          `text-base h-[1em] ` +
          (countdown !== undefined &&
            countdown <= 1 &&
            'transition-opacity duration-1000 opacity-0')
        }
      >
        {countdown !== undefined && countdown > 0 && isRetrying && (
          <span>Connecting in {countdown}s</span>
        )}
      </div>

      {CONNECTION_ERROR_TEXT[error.error] && !showManualConnect && (
        <div>
          <div className="inline-block max-w-3xl text-base gap-2 px-32 pt-2 mt-2 pb-6 mb-6 text-chalkboard-80 dark:text-chalkboard-20">
            {CONNECTION_ERROR_CALL_TO_ACTION_TEXT[error.error]} If it persists,
            please visit the community support thread on{' '}
            <a
              className="contents text-chalkboard-80 dark:text-chalkboard-10"
              href={diagnosingNetworkIssuesUrl}
              onClick={openExternalBrowserIfDesktop(diagnosingNetworkIssuesUrl)}
            >
              <span className="underline underline-offset-1">
                diagnosing network connection issues
              </span>
            </a>
            .
          </div>
        </div>
      )}
    </div>
  )
}

export default Loading
