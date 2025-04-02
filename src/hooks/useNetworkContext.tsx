import { createContext, useContext } from 'react'

import type { NetworkStatus } from '@src/hooks/useNetworkStatus'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import type { EngineConnectionState } from '@src/lang/std/engineConnection'
import {
  ConnectingTypeGroup,
  EngineConnectionStateType,
  initialConnectingTypeGroupState,
} from '@src/lang/std/engineConnection'

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
