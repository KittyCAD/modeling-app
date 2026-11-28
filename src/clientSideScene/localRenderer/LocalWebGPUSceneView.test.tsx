import { signal } from '@preact/signals-core'
import { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { LocalRendererHost } from '@src/clientSideScene/localRenderer/host'
import { LocalWebGPUSceneView } from '@src/clientSideScene/localRenderer/LocalWebGPUSceneView'
import { Themes } from '@src/lib/theme'
import { settingsMachine } from '@src/machines/settingsMachine'
import { commandBarMachine } from '@src/machines/commandBarMachine'
import { createActor } from 'xstate'
import { MachineManager } from '@src/lib/MachineManager'
import { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { createSettings } from '@src/lib/settings/initialSettings'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import fsZds from '@src/lib/fs-zds'
import { createFileOperationsServices } from '@src/registry/extensions/fileOperations'
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const renderer = vi.hoisted(() => ({
  dispose: vi.fn(),
  setTheme: vi.fn(),
  setPickingEnabled: vi.fn(),
  setDefaultPlaneVisibility: vi.fn(),
  setEnableSSAO: vi.fn(),
  setViewportRendering: vi.fn(),
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
vi.mock('@src/lib/boot', () => {
  throw new Error('Renderer presentation imported the legacy app bootstrap')
})
vi.mock('@src/hooks/useModelingContext', () => {
  throw new Error('Renderer presentation imported legacy modeling context')
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function sceneFixture() {
  const settings = createSettings()
  const wasm = new Promise<ModuleType>(() => {})
  const files = createFileOperationsServices(fsZds)
  const commands = createActor(commandBarMachine, {
    input: {
      commands: [],
      machineManager: new MachineManager(),
      wasmInstancePromise: wasm,
    },
  })
  // Unstarted actors provide typed snapshots without loading persisted settings or WASM.
  const settingsActor = createActor(settingsMachine, {
    input: {
      ...settings,
      commandBarActor: commands,
      wasmInstancePromise: wasm,
      defaultProjectLibraries: [],
      projectLibrarySettingDefaultPolicies: [],
      extensionSettings: {},
      fileOperations: files.operations,
    },
  })
  const manager = new ConnectionManager({ settingsActor })
  const sceneInfra = new SceneInfra(manager, wasm, () => settings)
  // The test's shared WebGL mock omits these browser cleanup operations.
  sceneInfra.renderer.clear = vi.fn()
  sceneInfra.renderer.forceContextLoss = vi.fn()
  return {
    sceneInfra,
    settingsActor,
    dispose: () => {
      sceneInfra.dispose()
      settingsActor.stop()
      commands.stop()
      return files.dispose()
    },
  }
}

it('mounts from an explicit host without app providers and releases only its renderer', ({
  onTestFinished,
}) => {
  const scene = sceneFixture()
  onTestFinished(scene.dispose)
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
    sceneInfra: scene.sceneInfra,
    settingsActor: scene.settingsActor,
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
      viewportRendering="default"
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
      viewportRendering="default"
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
