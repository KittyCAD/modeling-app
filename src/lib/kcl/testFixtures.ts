import { createSceneSelection } from '@src/lib/kcl/scene/selection'
import { signal } from '@preact/signals-core'
import { emptyExecState } from '@src/lang/wasm'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import { createScenePresentationPreferences } from '@src/lib/kcl/scene/presentationPreferences'
import type { KclRuntime } from '@src/lib/kcl/execution/runtime'
import type { KclSceneResource } from '@src/lib/kcl/scene/open'
import type { ScenePresentation } from '@src/lib/kcl/scene/connection'
import { MachineManager } from '@src/lib/MachineManager'
import { createSettings } from '@src/lib/settings/initialSettings'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { commandBarMachine } from '@src/machines/commandBarMachine'
import { settingsMachine } from '@src/machines/settingsMachine'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import { onTestFinished, vi } from 'vitest'
import { createActor } from 'xstate'

/** Unstarted actors supply real settings contracts without persistence or native initialization. */
export function createTestSettings() {
  const current = signal(createSettings())
  const wasm = new Promise<ModuleType>(() => {})
  const commands = createActor(commandBarMachine, {
    input: {
      commands: [],
      machineManager: new MachineManager(),
      wasmInstancePromise: wasm,
    },
  })
  const actor = createActor(settingsMachine, {
    input: {
      ...current.peek(),
      commandBarActor: commands,
      defaultProjectLibraries: [],
      projectLibrarySettingDefaultPolicies: [],
      extensionSettings: {},
      fileOperations: testFileOperations,
      wasmInstancePromise: wasm,
    },
  })
  onTestFinished(() => {
    actor.stop()
    commands.stop()
  })
  return {
    current,
    actor,
    get: () => current.value,
    send: (event) => actor.send(event),
    useSettings: () => current.value,
  } satisfies SettingsRegistryService
}

export function createTestKclRuntime() {
  return {
    nativeContextHost: {
      create: () =>
        Promise.reject(new Error('No native context in this fixture')),
      run: <T>(work: () => Promise<T>) => work(),
      deliverResponse: <T>(work: () => Promise<T>) => work(),
    },
    sources: signal<KclRuntime['sources']['value']>(undefined),
    borrowModel: vi.fn<KclRuntime['borrowModel']>(
      () => new Error('No native model in this fixture')
    ),
    endSketch: vi.fn<KclRuntime['endSketch']>(async () => {}),
    ast: signal<KclRuntime['ast']['value']>(null),
    fileSettings: signal<KclRuntime['fileSettings']['value']>({}),
    executionRevision: signal(0),
    executionElapsedMs: signal<number | null>(null),
    events: new EventTarget(),
    state: signal(emptyExecState()),
    executing: signal(false),
    failed: signal(false),
    execute: vi.fn<KclRuntime['execute']>(async () => emptyExecState()),
    exportModel: vi
      .fn<KclRuntime['exportModel']>()
      .mockResolvedValue(undefined),
    dispose: vi.fn<KclRuntime['dispose']>(async () => {}),
  } satisfies KclRuntime
}

/** Complete scene resources keep lifetime tests checked against the production contract. */
export function createTestKclScene(
  presentation: ScenePresentation = 'streamed',
  overrides: Partial<KclSceneResource> = {}
) {
  const settings = createSettings()
  const preferences = createScenePresentationPreferences(() => settings)
  onTestFinished(preferences.dispose)
  const selection = createSceneSelection(
    { pick: async () => undefined, present: async () => {} },
    ['face', 'edge', 'solid3d']
  )
  onTestFinished(selection.dispose)
  return {
    selection,
    commands: {
      sendSceneCommand: vi.fn<KclSceneResource['commands']['sendSceneCommand']>(
        async () => null
      ),
      pendingCommands: {},
    },
    captureScreenshot: vi.fn(() => ''),
    element: document.createElement('div'),
    presentation,
    localHost: undefined,
    preferences,
    snapshotCamera: vi.fn<KclSceneResource['snapshotCamera']>(() => ({
      pivot_rotation: { x: 0, y: 0, z: 0, w: 1 },
      pivot_position: { x: 0, y: 0, z: 0 },
      eye_offset: 100,
      fov_y: 45,
      is_ortho: false,
      ortho_scale_factor: 1.6,
      ortho_scale_enabled: true,
      world_coord_system: 'right_handed_up_z',
    })),
    restoreCamera: vi.fn<KclSceneResource['restoreCamera']>(async () => {}),
    runtime: createTestKclRuntime(),
    isConnected: () => true,
    resize: vi.fn<KclSceneResource['resize']>(async () => {}),
    resume: vi.fn<KclSceneResource['resume']>(),
    applySettings: vi.fn<KclSceneResource['applySettings']>(async () => {}),
    frameModel: vi.fn<KclSceneResource['frameModel']>(async () => {}),
    dispose: vi.fn<KclSceneResource['dispose']>(async () => {}),
    ...overrides,
  } satisfies KclSceneResource
}
