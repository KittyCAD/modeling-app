import {
  NetworkHealthState,
  useNetworkStatus,
} from '@src/hooks/useNetworkStatus'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import {
  EngineConnectionEvents,
  EngineConnectionManagerEvents,
  EngineConnectionStateType,
  initialConnectingTypeGroupState,
} from '@src/lib/engineConnection/utils'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

function createTestConnectionManager() {
  const connection = new EventTarget()
  const manager = new EventTarget() as EventTarget & {
    connection: EventTarget
  }
  manager.connection = connection

  return {
    connection,
    manager: manager as unknown as ConnectionManager,
  }
}

function publishEngineAvailable({
  connection,
  manager,
}: {
  connection: EventTarget
  manager: ConnectionManager
}) {
  manager.dispatchEvent(
    new CustomEvent(EngineConnectionManagerEvents.EngineAvailable, {
      detail: connection,
    })
  )
}

function publishHealthyConnectionSteps(connection: EventTarget) {
  for (const [connectingType] of Object.values(
    initialConnectingTypeGroupState
  ).flat()) {
    connection.dispatchEvent(
      new CustomEvent(EngineConnectionEvents.ConnectionStateChanged, {
        detail: {
          type: EngineConnectionStateType.Connecting,
          value: {
            type: connectingType,
          },
        },
      })
    )
  }
}

describe('useNetworkStatus', () => {
  it('exposes frames per second from the engine connection', async () => {
    const { connection, manager } = createTestConnectionManager()
    const { result } = renderHook(() => useNetworkStatus(manager))

    act(() => {
      publishEngineAvailable({ connection, manager })
      connection.dispatchEvent(
        new CustomEvent(EngineConnectionEvents.FramesPerSecondChanged, {
          detail: 59.6,
        })
      )
    })

    await waitFor(() => {
      expect(result.current.fps).toBe(60)
    })
  })

  it('reports weak health when an otherwise healthy stream has low FPS', async () => {
    const { connection, manager } = createTestConnectionManager()
    const { result } = renderHook(() => useNetworkStatus(manager))

    act(() => {
      publishEngineAvailable({ connection, manager })
      publishHealthyConnectionSteps(connection)
    })

    await waitFor(() => {
      expect(result.current.hasIssues).toBe(false)
    })

    act(() => {
      connection.dispatchEvent(
        new CustomEvent(EngineConnectionEvents.FramesPerSecondChanged, {
          detail: 12,
        })
      )
    })

    await waitFor(() => {
      expect(result.current.overallState).toBe(NetworkHealthState.Weak)
    })
  })
})
