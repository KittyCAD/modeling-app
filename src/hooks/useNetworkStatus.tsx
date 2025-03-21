import { useEffect, useState } from 'react'

import type {
  ConnectingType,
  EngineConnectionState,
  ErrorType,
} from '@src/lang/std/engineConnection'
import {
  ConnectingTypeGroup,
  DisconnectingType,
  EngineCommandManagerEvents,
  EngineConnectionEvents,
  EngineConnectionStateType,
  initialConnectingTypeGroupState,
} from '@src/lang/std/engineConnection'
import { engineCommandManager } from '@src/lib/singletons'

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
  error: ErrorType | undefined
  setHasCopied: (b: boolean) => void
  hasCopied: boolean
  ping: undefined | number
}

// Must be called from one place in the application.
// We've chosen the <Router /> component for this.
export function useNetworkStatus() {
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
  const [ping, setPing] = useState<undefined | number>(undefined)
  const [hasCopied, setHasCopied] = useState<boolean>(false)

  const [error, setError] = useState<ErrorType | undefined>(undefined)

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
    setOverallState(
      !internetConnected
        ? NetworkHealthState.Disconnected
        : hasIssues || hasIssues === undefined
        ? NetworkHealthState.Issue
        : ping > 16.6 * 3 // we consider ping longer than 3 frames as weak
        ? NetworkHealthState.Weak
        : NetworkHealthState.Ok
    )
  }, [hasIssues, internetConnected, ping])

  useEffect(() => {
    const onlineCallback = () => {
      setInternetConnected(true)
    }
    const offlineCallback = () => {
      setInternetConnected(false)
      setSteps(structuredClone(initialConnectingTypeGroupState))
    }
    window.addEventListener('online', onlineCallback)
    window.addEventListener('offline', offlineCallback)
    return () => {
      window.removeEventListener('online', onlineCallback)
      window.removeEventListener('offline', offlineCallback)
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
      setPing(state)
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

    const onEngineAvailable = ({ detail: engineConnection }: CustomEvent) => {
      engineConnection.addEventListener(
        EngineConnectionEvents.PingPongChanged,
        onPingPongChange as EventListener
      )
      engineConnection.addEventListener(
        EngineConnectionEvents.ConnectionStateChanged,
        onConnectionStateChange as EventListener
      )

      // Tell EngineConnection to start firing events.
      window.dispatchEvent(new CustomEvent('use-network-status-ready', {}))
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
      engineCommandManager.engineConnection?.addEventListener(
        EngineConnectionEvents.PingPongChanged,
        onPingPongChange as EventListener
      )
      engineCommandManager.engineConnection?.addEventListener(
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
    ping,
  }
}
