import type { NetworkStatus } from '@src/hooks/useNetworkStatus'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import {
  ConnectingTypeGroup,
  EngineConnectionStateType,
  initialConnectingTypeGroupState,
} from '@src/lib/engineConnection/utils'
import { createContext, useContext } from 'react'

export const NetworkContext = createContext<NetworkStatus>({
  immediateState: {
    type: EngineConnectionStateType.Disconnected,
  },
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
  setHasCopied: (_b: boolean) => {},
  hasCopied: false,
  ping: undefined,
  fps: undefined,
})
export const useNetworkContext = () => {
  return useContext(NetworkContext)
}
