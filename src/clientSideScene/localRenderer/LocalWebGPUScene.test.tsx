import { signal } from '@preact/signals-core'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { LocalRendererHost } from '@src/clientSideScene/localRenderer/host'
import { LocalWebGPUSceneView } from '@src/clientSideScene/localRenderer/LocalWebGPUScene'
import { Themes } from '@src/lib/theme'
import type { SettingsActorType } from '@src/machines/settingsMachine'
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const renderer = vi.hoisted(() => ({
  dispose: vi.fn(),
  setTheme: vi.fn(),
  setPickingEnabled: vi.fn(),
  setDefaultPlaneVisibility: vi.fn(),
  setEnableSSAO: vi.fn(),
  setEdgeHighlighting: vi.fn(),
  setFixedSizeGrid: vi.fn(),
  setBackfaceColor: vi.fn(),
}))
const createRenderer = vi.hoisted(() => vi.fn())
vi.mock('@src/clientSideScene/localRenderer/LocalRenderer', () => ({
  LocalRenderer: class {
    constructor(...args: unknown[]) {
      createRenderer(...args)
      return renderer
    }
  },
}))
vi.mock('@src/lib/boot', () => ({
  useSingletons: () => {
    throw new Error('Presentation requested app singletons')
  },
}))
vi.mock('@src/hooks/useModelingContext', () => ({
  useModelingContext: () => {
    throw new Error('Presentation requested modeling context')
  },
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('mounts from an explicit host without app providers and releases only its renderer', () => {
  const host: LocalRendererHost = {
    executionEvents: new EventTarget(),
    executing: signal(false),
    sceneGeneration: signal(null),
    currentSceneGeneration: () => null,
    selectionFilter: signal([]),
    commands: {
      pendingCommands: {},
      sendSceneCommand: vi.fn().mockResolvedValue(null),
      setLocalSelectionCommandHandler: vi.fn(),
    },
    sceneInfra: { localRenderer: null } as SceneInfra,
    settingsActor: {} as SettingsActorType,
    artifacts: () => new Map(),
    defaultPlanes: () => ({
      xy: 'xy',
      yz: 'yz',
      xz: 'xz',
      negXy: 'negXy',
      negXz: 'negXz',
      negYz: 'negYz',
    }),
    hasErrors: () => false,
    exportModel: vi.fn().mockResolvedValue(undefined),
  }
  const { unmount, rerender } = render(
    <LocalWebGPUSceneView
      host={host}
      theme={Themes.Light}
      enableSSAO={false}
      shouldHighlightEdges={false}
      fixedSizeGrid={true}
      backfaceColor="#00D5FF"
      pickingEnabled={false}
      defaultPlaneVisibility={{ xy: true, xz: false, yz: false }}
    />
  )
  expect(createRenderer).toHaveBeenCalledExactlyOnceWith(
    expect.any(HTMLDivElement),
    host,
    expect.any(Object)
  )
  expect(host.sceneInfra.localRenderer).toBe(renderer)
  rerender(
    <LocalWebGPUSceneView
      host={host}
      theme={Themes.Light}
      enableSSAO={false}
      shouldHighlightEdges={false}
      fixedSizeGrid={true}
      backfaceColor="#00D5FF"
      pickingEnabled={true}
      defaultPlaneVisibility={{ xy: false, xz: true, yz: false }}
    />
  )
  expect(renderer.setPickingEnabled).toHaveBeenLastCalledWith(true)
  expect(renderer.setDefaultPlaneVisibility).toHaveBeenLastCalledWith({
    xy: false,
    xz: true,
    yz: false,
  })
  expect(createRenderer).toHaveBeenCalledTimes(1)
  unmount()
  expect(renderer.dispose).toHaveBeenCalledTimes(1)
  expect(host.sceneInfra.localRenderer).toBeNull()
})
