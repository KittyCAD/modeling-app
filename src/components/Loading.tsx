import { useEffect, useState } from 'react'

import {
  EngineConnectionStateType,
  DisconnectingType,
  EngineCommandManagerEvents,
  EngineConnectionEvents,
  ConnectionError,
  CONNECTION_ERROR_TEXT,
} from '../lang/std/engineConnection'

import { engineCommandManager } from '../lib/singletons'

const Loading = ({ children }: React.PropsWithChildren) => {
  const [error, setError] = useState<ConnectionError>(ConnectionError.Unset)

  useEffect(() => {
    const onConnectionStateChange = ({ detail: state }: CustomEvent) => {
      if (
        (state.type !== EngineConnectionStateType.Disconnected ||
          state.type !== EngineConnectionStateType.Disconnecting) &&
        state.value?.type !== DisconnectingType.Error
      )
        return
      setError(state.value.value.error)
    }

    const onEngineAvailable = ({ detail: engineConnection }: CustomEvent) => {
      engineConnection.addEventListener(
        EngineConnectionEvents.ConnectionStateChanged,
        onConnectionStateChange as EventListener
      )
    }

    engineCommandManager.addEventListener(
      EngineCommandManagerEvents.EngineAvailable,
      onEngineAvailable as EventListener
    )

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
  }, [])

  useEffect(() => {
    // Don't set long loading time if there's a more severe error
    if (error > ConnectionError.LongLoadingTime) return

    const timer = setTimeout(() => {
      setError(ConnectionError.LongLoadingTime)
    }, 4000)

    return () => clearTimeout(timer)
  }, [error, setError])

  return (
    <div
      className="body-bg flex flex-col items-center justify-center h-screen"
      data-testid="loading"
    >
      <svg viewBox="0 0 10 10" className="w-8 h-8">
        <circle
          cx="5"
          cy="5"
          r="4"
          stroke="var(--primary)"
          fill="none"
          strokeDasharray="4, 4"
          className="animate-spin origin-center"
        />
      </svg>
      <p className="text-base mt-4 text-primary">{children || 'Loading'}</p>
      <p
        className={
          'text-sm mt-4 text-primary/60 transition-opacity duration-500' +
          (error !== ConnectionError.Unset ? ' opacity-100' : ' opacity-0')
        }
      >
        {CONNECTION_ERROR_TEXT[error]}
      </p>
    </div>
  )
}

export default Loading
