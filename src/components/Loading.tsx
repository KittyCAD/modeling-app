import { useEffect, useState } from 'react'

// import {
//   ConnectingType,
//   ConnectingTypeGroup,
//   DisconnectingType,
//   EngineCommandManagerEvents,
//   EngineConnectionEvents,
//   EngineConnectionStateType,
//   ErrorType,
//   initialConnectingTypeGroupState,
// } from '../lang/std/engineConnection'
// import { engineCommandManager } from '../lib/singletons'

// Sorted by severity
enum Error {
  Unset = 0,
  LongLoadingTime,
  BadAuthToken,
  TooManyConnections,
}

const errorText: Record<Error, string> = {
  [Error.Unset]: "",
  [Error.LongLoadingTime]: "Loading is taking longer than expected...",
  [Error.BadAuthToken]: "Your authorization token is not valid; please login again.",
  [Error.TooManyConnections]: "There are too many connections.",
}

const Loading = ({ children }: React.PropsWithChildren) => {
  const [error, setError] = useState<Error>(Error.Unset)

  useEffect(() => {
    // Don't set long loading time if there's a more severe error
    if (error > Error.LongLoadingTime) return

    const timer = setTimeout(() => {
      setError(Error.LongLoadingTime)
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
          (error !== Error.Unset ? ' opacity-100' : ' opacity-0')
        }
      >
        { errorText[error] }
      </p>
    </div>
  )
}

export default Loading
