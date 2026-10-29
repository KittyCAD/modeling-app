const { useApp } = vi.hoisted(() => ({ useApp: vi.fn() }))
vi.mock('@src/lib/boot', () => ({ useApp }))

import {
  defineRegistryItem,
  provideService,
  Registry,
} from '@kittycad/registry'
import { useOnPageResize } from '@src/hooks/network/useOnPageResize'
import { ConnectionAvailability } from '@src/lib/engineConnection/connectionManager'
import engineConnectionRegistryItem from '@src/lib/engineConnection/registry'
import { engineConnectionService } from '@src/lib/engineConnection/registry/contract'
import {
  type SettingsRegistryService,
  settingsService,
} from '@src/registry/contracts/settings'
import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

let registry: Registry | undefined

afterEach(() => {
  registry?.[Symbol.dispose]()
  registry = undefined
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  useApp.mockReset()
})

it('starts and stops observing resize when service availability changes', () => {
  registry = new Registry()
  registry.configure([
    defineRegistryItem({
      providesServices: [
        provideService(settingsService, {
          actor: {},
        } as SettingsRegistryService),
      ],
    }),
    engineConnectionRegistryItem,
  ])
  useApp.mockReturnValue({ registry })
  const manager = registry.get(engineConnectionService).manager
  const observe = vi.fn()
  const disconnect = vi.fn()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = observe
      disconnect = disconnect
    }
  )
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const wrapper = document.createElement('div')
  const { unmount } = renderHook(() =>
    useOnPageResize({
      videoWrapperRef: { current: wrapper },
      videoRef: { current: document.createElement('video') },
      canvasRef: { current: document.createElement('canvas') },
      engineCommandManager: manager,
    })
  )

  expect(observe).not.toHaveBeenCalled()
  act(() => {
    manager.availability = ConnectionAvailability.AcceptingInput
  })
  expect(observe).toHaveBeenCalledExactlyOnceWith(wrapper)

  act(() => {
    manager.tearDown({ route: 'service-disposed', initiatedBy: 'client' })
  })
  expect(disconnect).toHaveBeenCalledOnce()

  act(() => {
    manager.availability = ConnectionAvailability.AcceptingInput
  })
  expect(observe).toHaveBeenCalledTimes(2)
  unmount()
  expect(disconnect).toHaveBeenCalledTimes(2)
})
