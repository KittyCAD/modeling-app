import { useEffect, useState } from 'react'
import type { ConnectionManager } from '@src/network/connectionManager'
import {
  ConnectingTypeGroup,
  DisconnectingType,
  EngineCommandManagerEvents,
  EngineConnectionEvents,
  EngineConnectionStateType,
  initialConnectingTypeGroupState,
} from '@src/network/utils'
import type {
  ConnectingType,
  EngineConnectionState,
  IErrorType,
} from '@src/network/utils'

export enum NetworkHealthState {
  Ok,
  Weak,
  Issue,
  Disconnected,
}

export interface NetworkStatus {
  immediateState: EngineConnectionState
  hasIssues: boolean | undefined
  overallState: NetworkHealthState
  internetConnected: boolean
  steps: typeof initialConnectingTypeGroupState
  issues: Record<ConnectingTypeGroup, boolean | undefined>
  error: IErrorType | undefined
  setHasCopied: (b: boolean) => void
  hasCopied: boolean
  ping: undefined | number
}

// Must be called from one place in the application.
// We've chosen the <Router /> component for this.
export function useNetworkStatus(engineCommandManager: ConnectionManager) {
  const [immediateState, setImmediateState] = useState<EngineConnectionState>({
    type: EngineConnectionStateType.Disconnected,
  })
  const [steps, setSteps] = useState(
    structuredClone(initialConnectingTypeGroupState)
  )
  const [internetConnected, setInternetConnected] = useState<boolean>(true)
  const [overallState, setOverallState] = useState<NetworkHealthState>(
    NetworkHealthState.Disconnected
  )
  const [pingRaw, setPingRaw] = useState<undefined | number>(undefined)
  const [pingEMA, setPingEMA] = useState<undefined | number>(undefined)
  const [hasCopied, setHasCopied] = useState<boolean>(false)

  const [error, setError] = useState<IErrorType | undefined>(undefined)

  const hasIssue = (i: [ConnectingType, boolean | undefined]) =>
    i[1] === undefined ? i[1] : !i[1]

  const [issues, setIssues] = useState<
    Record<ConnectingTypeGroup, boolean | undefined>
  >({
    [ConnectingTypeGroup.WebSocket]: undefined,
    [ConnectingTypeGroup.ICE]: undefined,
    [ConnectingTypeGroup.WebRTC]: undefined,
  })

  const [hasIssues, setHasIssues] = useState<boolean | undefined>(undefined)
  useEffect(() => {
    if (immediateState.type === EngineConnectionStateType.Disconnecting) {
      // Reset our running average.
      setPingRaw(undefined)
      setPingEMA(undefined)
    }
  }, [immediateState])

  useEffect(() => {
    if (!pingRaw) return

    // We use an exponential running average to smooth out ping values.
    const pingDataPointsToConsider = 10
    const multiplier = 2 / (pingDataPointsToConsider + 1)
    let pingEMANext = ((pingEMA ?? 0) + pingRaw) / 2
    pingEMANext = pingEMANext * multiplier + (pingEMA ?? 0) * (1 - multiplier)
    setPingEMA(pingEMANext)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [pingRaw])

  useEffect(() => {
    // We consider ping longer than 3 frames as weak
    const WEAK_PING = 16.6 * 3
    const OK_PING = 16.6 * 2

    // A is used in the literature to specify the "window" of switching
    const A = 1.25

    const CENTER = (WEAK_PING + OK_PING) / 2
    const THRESHOLD_GOOD = CENTER / A // Lower bound
    const THRESHOLD_WEAK = CENTER * A // Upper bound

    let nextOverallState = overallState

    if (!internetConnected) {
      nextOverallState = NetworkHealthState.Disconnected
    } else if (hasIssues || hasIssues === undefined) {
      nextOverallState = NetworkHealthState.Issue
    } else if (pingEMA && pingEMA < THRESHOLD_GOOD) {
      nextOverallState = NetworkHealthState.Ok
    } else if (pingEMA && pingEMA > THRESHOLD_WEAK) {
      nextOverallState = NetworkHealthState.Weak
    } else {
      nextOverallState = NetworkHealthState.Ok
    }

    if (nextOverallState === overallState) return

    setOverallState(nextOverallState)
  }, [hasIssues, internetConnected, pingEMA, overallState])

  useEffect(() => {
    const offlineCallback = () => {
      setInternetConnected(false)
      setSteps(structuredClone(initialConnectingTypeGroupState))
    }
    engineCommandManager.addEventListener(
      EngineCommandManagerEvents.Offline,
      offlineCallback
    )
    return () => {
      engineCommandManager.removeEventListener(
        EngineCommandManagerEvents.Offline,
        offlineCallback
      )
    }
  }, [])

  useEffect(() => {
    const issues = {
      [ConnectingTypeGroup.WebSocket]: steps[
        ConnectingTypeGroup.WebSocket
      ].reduce(
        (acc: boolean | undefined, a) =>
          acc === true || acc === undefined ? acc : hasIssue(a),
        false
      ),
      [ConnectingTypeGroup.ICE]: steps[ConnectingTypeGroup.ICE].reduce(
        (acc: boolean | undefined, a) =>
          acc === true || acc === undefined ? acc : hasIssue(a),
        false
      ),
      [ConnectingTypeGroup.WebRTC]: steps[ConnectingTypeGroup.WebRTC].reduce(
        (acc: boolean | undefined, a) =>
          acc === true || acc === undefined ? acc : hasIssue(a),
        false
      ),
    }
    setIssues(issues)
  }, [steps])

  useEffect(() => {
    setHasIssues(
      issues[ConnectingTypeGroup.WebSocket] ||
        issues[ConnectingTypeGroup.ICE] ||
        issues[ConnectingTypeGroup.WebRTC]
    )
  }, [issues])

  useEffect(() => {
    const onPingPongChange = ({ detail: state }: CustomEvent) => {
      setPingRaw(state)
    }

    const onConnectionStateChange = ({
      detail: engineConnectionState,
    }: CustomEvent) => {
      setImmediateState(engineConnectionState)
      setSteps((steps) => {
        let nextSteps = structuredClone(steps)
        if (
          engineConnectionState.type === EngineConnectionStateType.Connecting
        ) {
          setInternetConnected(true)

          const groups = Object.values(nextSteps)
          for (let group of groups) {
            for (let step of group) {
              if (step[0] !== engineConnectionState.value.type) continue
              step[1] = true
            }
          }
        }

        if (
          engineConnectionState.type === EngineConnectionStateType.Disconnecting
        ) {
          const groups = Object.values(nextSteps)
          for (let group of groups) {
            for (let step of group) {
              if (
                engineConnectionState.value.type === DisconnectingType.Error
              ) {
                if (
                  engineConnectionState.value.value.lastConnectingValue
                    ?.type === step[0]
                ) {
                  step[1] = false
                }
              }
            }

            if (engineConnectionState.value.type === DisconnectingType.Error) {
              setError(engineConnectionState.value.value)
            } else if (
              engineConnectionState.value.type === DisconnectingType.Quit
            ) {
              return structuredClone(initialConnectingTypeGroupState)
            }
          }
        }

        // Reset the state of all steps if we have disconnected.
        if (
          engineConnectionState.type === EngineConnectionStateType.Disconnected
        ) {
          return structuredClone(initialConnectingTypeGroupState)
        }

        return nextSteps
      })
    }

    const onEngineAvailable = ({ detail: connection }: CustomEvent) => {
      connection.addEventListener(
        EngineConnectionEvents.PingPongChanged,
        onPingPongChange as EventListener
      )
      connection.addEventListener(
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

      // When the component is unmounted these should be assigned, but it's possible
      // the component mounts and unmounts before engine is available.
      engineCommandManager.connection?.removeEventListener(
        EngineConnectionEvents.PingPongChanged,
        onPingPongChange as EventListener
      )
      engineCommandManager.connection?.removeEventListener(
        EngineConnectionEvents.ConnectionStateChanged,
        onConnectionStateChange as EventListener
      )
    }
  }, [])

  return {
    immediateState,
    hasIssues,
    overallState,
    internetConnected,
    steps,
    issues,
    error,
    setHasCopied,
    hasCopied,
    ping: pingEMA !== undefined ? Math.trunc(pingEMA) : pingEMA,
  }
}
