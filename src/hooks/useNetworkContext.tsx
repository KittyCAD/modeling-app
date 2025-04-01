import { createContext, useContext } from 'react'
import {
  ConnectingTypeGroup,
  EngineConnectionStateType,
  EngineConnectionState,
  initialConnectingTypeGroupState,
} from '../lang/std/engineConnection'
import { NetworkStatus, NetworkHealthState } from './useNetworkStatus'

export const NetworkContext = createContext<NetworkStatus>({
  immediateState: {
    type: EngineConnectionStateType.Disconnected,
  } as EngineConnectionState,
  hasIssues: undefined,
  overallState: NetworkHealthState.Disconnected,
  internetConnected: true,
  steps: structuredClone(initialConnectingTypeGroupState),
  issues: {
    [ConnectingTypeGroup.WebSocket]: undefined,
    [ConnectingTypeGroup.ICE]: undefined,
    [ConnectingTypeGroup.WebRTC]: undefined,
  },
  error: undefined,
  setHasCopied: (b: boolean) => {},
  hasCopied: false,
  pingPongHealth: undefined,
} as NetworkStatus)
export const useNetworkContext = () => {
  return useContext(NetworkContext)
}
