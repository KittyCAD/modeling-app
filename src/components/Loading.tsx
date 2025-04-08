import { useEffect, useState } from 'react'

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
import { engineCommandManager } from '@src/lib/singletons'

interface LoadingProps extends React.PropsWithChildren {
  className?: string
}

const Loading = ({ children, className }: LoadingProps) => {
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
    if (error > ConnectionError.LongLoadingTime) return

    const shorterTimer = setTimeout(() => {
      setError({ error: ConnectionError.LongLoadingTime })
    }, 4000)
    const longerTimer = setTimeout(() => {
      setError({ error: ConnectionError.VeryLongLoadingTime })
    }, 7000)

    return () => clearTimeout(timer)
  }, [error, setError])

  return (
    <div
      className={`body-bg flex flex-col items-center justify-center h-screen ${className}`}
      data-testid="loading"
    >
      <Spinner />
      <p className="text-base mt-4 text-primary">{children || 'Loading'}</p>
      <p
        className={
          'text-sm mt-4 text-primary/60 transition-opacity duration-500' +
          (error !== ConnectionError.Unset ? ' opacity-100' : ' opacity-0')
        }
      >
        {CONNECTION_ERROR_TEXT[error]}
      </p>
      {CONNECTION_ERROR_TEXT[error.error] && (
        <div
          className={
            'text-center text-sm mt-4 text-opacity-70 transition-opacity duration-500' +
            (error.error !== ConnectionError.Unset
              ? ' opacity-100'
              : ' opacity-0')
          }
          dangerouslySetInnerHTML={{
            __html: Marked.parse(
              CONNECTION_ERROR_TEXT[error.error] +
                (error.context
                  ? '\n\nThe error details are: ' + error.context
                  : ''),
              {
                renderer: new SafeRenderer(markedOptions),
                ...markedOptions,
              }
            ),
          }}
        ></div>
      )}
    </div>
  )
}

export default Loading
