import type { MarkedOptions } from '@ts-stack/markdown'
import { Marked, escape, unescape } from '@ts-stack/markdown'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { CustomIcon } from '@src/components/CustomIcon'
import { Spinner } from '@src/components/Spinner'
import type { ErrorType } from '@src/lang/std/engineConnection'
import {
  CONNECTION_ERROR_TEXT,
  ConnectionError,
  DisconnectingType,
  EngineCommandManagerEvents,
  EngineConnectionEvents,
  EngineConnectionStateType,
} from '@src/lang/std/engineConnection'
import { SafeRenderer } from '@src/lib/markdown'
import { engineCommandManager } from '@src/lib/singletons'

interface LoadingProps extends React.PropsWithChildren {
  className?: string
  dataTestId?: string
}

const markedOptions: MarkedOptions = {
  gfm: true,
  breaks: true,
  sanitize: true,
  unescape,
  escape,
}

// This exists here and not in engineConnection because we want some styling
// available to us.
export const CONNECTION_ERROR_CALL_TO_ACTION_TEXT: Record<
  ConnectionError,
  ReactNode
> = {
  [ConnectionError.Unset]: '',
  [ConnectionError.LongLoadingTime]:
    'Loading is taking longer than expected, check your network connection.',
  [ConnectionError.VeryLongLoadingTime]:
    'Check the connection is being blocked by a firewall, or if your internet is disconnected.',
  [ConnectionError.ICENegotiate]:
    'The modeling session was created, but there is an issue connecting to the stream.',
  [ConnectionError.DataChannelError]:
    'A modeling session was created, but there was an issue creating a modeling commands channel.',
  [ConnectionError.WebSocketError]:
    "An unexpected issue regarding the connection to Zoo's KittyCAD API happened. We suggest re-opening Zoo Design Studio to try again.",
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
      <a href="https://status.zoo.dev">status.zoo.dev</a> for updates.
    </>
  ),
  [ConnectionError.PeerConnectionRemoteDisconnected]:
    'The remote end has disconnected. Zoo Design Studio will reconnect you.',
  [ConnectionError.Unknown]:
    'An unexpected error occurred. Please report this to us.',
}

const Loading = ({ children, className, dataTestId }: LoadingProps) => {
  const [error, setError] = useState<ErrorType>({
    error: ConnectionError.Unset,
  })
  const isUnrecoverableError = error.error > ConnectionError.VeryLongLoadingTime
  const colorClass =
    error.error === ConnectionError.Unset
      ? 'text-primary'
      : !isUnrecoverableError
        ? 'text-warn-60'
        : 'text-chalkboard-60 dark:text-chalkboard-40'
  useEffect(() => {
    const onConnectionStateChange = ({ detail: state }: CustomEvent) => {
      if (
        (state.type !== EngineConnectionStateType.Disconnected ||
          state.type !== EngineConnectionStateType.Disconnecting) &&
        state.value?.type !== DisconnectingType.Error
      )
        return
      setError(state.value.value)
    }

    const onEngineAvailable = ({ detail: engineConnection }: CustomEvent) => {
      engineConnection.addEventListener(
        EngineConnectionEvents.ConnectionStateChanged,
        onConnectionStateChange as EventListener
      )
    }

    if (engineCommandManager.engineConnection) {
      // Do an initial state check in case there is an immediate issue
      onConnectionStateChange(
        new CustomEvent(EngineConnectionEvents.ConnectionStateChanged, {
          detail: engineCommandManager.engineConnection.state,
        })
      )
      // Set up a listener on the state for future updates
      onEngineAvailable(
        new CustomEvent(EngineCommandManagerEvents.EngineAvailable, {
          detail: engineCommandManager.engineConnection,
        })
      )
    } else {
      // If there is no engine connection yet, listen for it to be there *then*
      // attach the listener
      engineCommandManager.addEventListener(
        EngineCommandManagerEvents.EngineAvailable,
        onEngineAvailable as EventListener
      )
    }

    return () => {
      engineCommandManager.removeEventListener(
        EngineCommandManagerEvents.EngineAvailable,
        onEngineAvailable as EventListener
      )
      engineCommandManager.engineConnection?.removeEventListener(
        EngineConnectionEvents.ConnectionStateChanged,
        onConnectionStateChange as EventListener
      )
    }
  }, [engineCommandManager, engineCommandManager.engineConnection])

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

  return (
    <div
      className={`body-bg flex flex-col items-center justify-center ${colorClass} ${className}`}
      data-testid={dataTestId ? dataTestId : 'loading'}
    >
      {isUnrecoverableError ? (
        <CustomIcon
          name="exclamationMark"
          className="w-8 h-8 !text-chalkboard-10 bg-destroy-60 rounded-full"
        />
      ) : (
        <Spinner />
      )}
      <p className={`text-base mt-4`}>
        {isUnrecoverableError ? '' : children || 'Loading'}
      </p>
      {CONNECTION_ERROR_TEXT[error.error] && (
        <div>
          <div className="max-w-3xl text-base flex flex-col gap-2 px-2 pt-2 mt-2 pb-6 mb-6 border-b border-chalkboard-30">
            {CONNECTION_ERROR_CALL_TO_ACTION_TEXT[error.error]}
            <div className="text-sm">
              If the issue persists, please visit the community support thread
              on{' '}
              <a href="https://community.zoo.dev/t/diagnosing-network-connection-issues/156">
                diagnosing network connection issues
              </a>
              .
            </div>
          </div>
          <div
            className={
              'font-mono text-xs px-2 text-opacity-70 transition-opacity duration-500' +
              (error.error !== ConnectionError.Unset
                ? ' opacity-100'
                : ' opacity-0')
            }
            dangerouslySetInnerHTML={{
              __html: Marked.parse(
                CONNECTION_ERROR_TEXT[error.error] +
                  (error.context
                    ? '\n\nThe error details are: ' +
                      (error.context instanceof Object
                        ? JSON.stringify(error.context)
                        : error.context)
                    : ''),
                {
                  renderer: new SafeRenderer(markedOptions),
                  ...markedOptions,
                }
              ),
            }}
          ></div>
        </div>
      )}
    </div>
  )
}

export default Loading
