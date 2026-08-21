import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockToast } = vi.hoisted(() => ({
  mockToast: {
    dismiss: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('react-hot-toast', () => ({
  default: mockToast,
}))

import type { CameraViewState } from '@kittycad/lib'
import type { ModulePath } from '@rust/kcl-lib/bindings/ModulePath'
import { signal } from '@preact/signals-core'

import type { KclManager } from '@src/lang/KclManager'
import type { KclNamedView } from '@src/lang/std/kclNamedViews'
import type { Artifact, ExecState, KclNamedViewArtifact } from '@src/lang/wasm'
import {
  activateNamedView,
  activeViewSignal,
  hasNamedViewsUi,
  isSameView,
  isSketchSessionOpen,
  moduleKeyOf,
  reapplyActiveViewAfterReconnect,
  resetNamedViewSession,
} from '@src/lib/kclNamedViewActivation'

const MAIN_PATH: ModulePath = { type: 'Main' }

const CODE_REF = {
  range: [0, 0, 0] as [number, number, number],
  nodePath: { steps: [] },
  pathToNode: [],
}

const SAVED_CAMERA = { eye_offset: 42 } as unknown as CameraViewState

/** An unconsumed extrusion, so the universe has one member to report on. */
function body(id: string): Extract<Artifact, { type: 'sweep' }> {
  return {
    type: 'sweep',
    id,
    subType: 'extrusion',
    pathId: `${id}-path`,
    surfaceIds: [],
    edgeIds: [],
    method: 'new',
    trajectoryId: null,
    consumed: false,
    codeRef: CODE_REF,
  }
}

function namedViewArtifact(name: string): KclNamedViewArtifact {
  return {
    id: `view-${name}`,
    name,
    camera: {
      look: { type: 'oriented', orientation: 'front' },
      target: null,
      distance: null,
      projection: 'orthographic',
    },
    baseline: 'show',
    showIds: [],
    hideIds: [],
    codeRef: CODE_REF,
  }
}

function declaredView(name: string): KclNamedView {
  return {
    artifact: namedViewArtifact(name),
    moduleId: 0,
    modulePath: MAIN_PATH,
  }
}

function execStateWith({
  views = ['Front'],
  bodies = ['body-1'],
}: {
  views?: string[]
  bodies?: string[]
} = {}): ExecState {
  const artifacts: Artifact[] = [
    ...bodies.map(body),
    ...views.map((name) => ({
      type: 'namedView' as const,
      ...namedViewArtifact(name),
    })),
  ]

  return {
    artifactGraph: new Map(
      artifacts.map((artifact) => [artifact.id, artifact])
    ),
    operations: [],
    filenames: { 0: MAIN_PATH },
  } as unknown as ExecState
}

type ModelingStateFake = Parameters<typeof isSketchSessionOpen>[0]

function modelingStateIn(stateValue: string): ModelingStateFake {
  return {
    matches: (value: string) => value === stateValue,
  } as unknown as ModelingStateFake
}

function setFlag(enabled: boolean) {
  ;(window as unknown as { app?: unknown }).app = {
    userFeatures: { has: () => enabled },
  }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function fakes({ isReady = true }: { isReady?: boolean } = {}) {
  const setObjectsHidden = vi.fn().mockResolvedValue(null)
  const setCameraToAxis = vi.fn().mockResolvedValue(undefined)
  const sendSceneCommand = vi.fn().mockResolvedValue(null)
  const setCameraProjection = vi.fn().mockResolvedValue(undefined)
  const getCameraView = vi.fn().mockResolvedValue(SAVED_CAMERA)
  const setCameraView = vi.fn().mockResolvedValue(undefined)
  const engineSceneGenerationSignal = signal(0)

  const raw = {
    execState: execStateWith(),
    errors: [] as unknown[],
    modelingState: null as ModelingStateFake,
    engineSceneGenerationSignal,
    engineCommandManager: { setObjectsHidden, sendSceneCommand, isReady },
    sceneInfra: {
      camControls: {
        setCameraToAxis,
        setCameraProjection,
        getCameraView,
        setCameraView,
        target: { x: 0, y: 0, z: 0 },
        camera: { position: { distanceTo: () => 1 } },
      },
    },
  }

  return {
    raw,
    kclManager: raw as unknown as KclManager,
    setObjectsHidden,
    setCameraToAxis,
    sendSceneCommand,
    getCameraView,
    setCameraView,
    engineSceneGenerationSignal,
  }
}

async function activateFront(f: ReturnType<typeof fakes>) {
  await activateNamedView({
    target: { kind: 'declared', view: declaredView('Front') },
    kclManager: f.kclManager,
  })
  f.setObjectsHidden.mockClear()
  f.setCameraToAxis.mockClear()
  f.sendSceneCommand.mockClear()
}

describe('hasNamedViewsUi', () => {
  afterEach(() => {
    delete (window as unknown as { app?: unknown }).app
  })

  it('is false when no app is on the window', () => {
    delete (window as unknown as { app?: unknown }).app
    expect(hasNamedViewsUi()).toBe(false)
  })

  it('follows the feature flag', () => {
    setFlag(true)
    expect(hasNamedViewsUi()).toBe(true)
    setFlag(false)
    expect(hasNamedViewsUi()).toBe(false)
  })
})

describe('moduleKeyOf', () => {
  it('distinguishes the module kinds and reports an absent path', () => {
    expect(moduleKeyOf(undefined)).toBeUndefined()
    expect(moduleKeyOf({ type: 'Main' })).toBe('Main')
    expect(
      moduleKeyOf({
        type: 'Local',
        value: '/project/parts/bracket.kcl',
        original_import_path: 'parts/bracket.kcl',
      })
    ).toBe('Local:/project/parts/bracket.kcl')
    expect(moduleKeyOf({ type: 'Std', value: 'std::view' })).toBe(
      'Std:std::view'
    )
  })
})

describe('isSameView', () => {
  it('treats Default View as itself and as nothing else', () => {
    expect(isSameView(null, null)).toBe(true)
    expect(isSameView(null, { name: 'Front', moduleKey: 'Main' })).toBe(false)
    expect(isSameView({ name: 'Front', moduleKey: 'Main' }, null)).toBe(false)
  })

  it('separates one name declared by two modules', () => {
    expect(
      isSameView(
        { name: 'Front', moduleKey: 'Local:/project/main.kcl' },
        { name: 'Front', moduleKey: 'Local:/project/parts/bracket.kcl' }
      )
    ).toBe(false)
  })

  it('matches the same name in the same module', () => {
    expect(
      isSameView(
        { name: 'Front', moduleKey: 'Main' },
        { name: 'Front', moduleKey: 'Main' }
      )
    ).toBe(true)
  })

  it('separates two names from one module', () => {
    expect(
      isSameView(
        { name: 'Front', moduleKey: 'Main' },
        { name: 'Back', moduleKey: 'Main' }
      )
    ).toBe(false)
  })
})

describe('isSketchSessionOpen', () => {
  it('reports both sketch sessions and nothing else', () => {
    expect(isSketchSessionOpen(modelingStateIn('Sketch'))).toBe(true)
    expect(isSketchSessionOpen(modelingStateIn('sketchSolveMode'))).toBe(true)
    expect(isSketchSessionOpen(modelingStateIn('idle'))).toBe(false)
  })

  it('reports no session before a modeling state exists', () => {
    expect(isSketchSessionOpen(null)).toBe(false)
    expect(isSketchSessionOpen(undefined)).toBe(false)
  })
})

describe('activateNamedView', () => {
  beforeEach(() => {
    resetNamedViewSession()
    mockToast.error.mockClear()
  })

  afterEach(() => {
    delete (window as unknown as { app?: unknown }).app
    resetNamedViewSession()
  })

  it('sends nothing while the flag is off', async () => {
    setFlag(false)
    const f = fakes()

    await activateNamedView({
      target: { kind: 'declared', view: declaredView('Front') },
      kclManager: f.kclManager,
    })

    expect(f.setObjectsHidden).not.toHaveBeenCalled()
    expect(f.setCameraToAxis).not.toHaveBeenCalled()
    expect(activeViewSignal.value).toBeNull()
  })

  it('sends nothing while a command would not reach the engine', async () => {
    setFlag(true)
    const f = fakes({ isReady: false })

    await activateNamedView({
      target: { kind: 'declared', view: declaredView('Front') },
      kclManager: f.kclManager,
    })

    expect(f.setObjectsHidden).not.toHaveBeenCalled()
    expect(f.setCameraToAxis).not.toHaveBeenCalled()
    expect(activeViewSignal.value).toBeNull()
  })

  it('sends the visibility of every universe member and the camera', async () => {
    setFlag(true)
    const f = fakes()

    await activateNamedView({
      target: { kind: 'declared', view: declaredView('Front') },
      kclManager: f.kclManager,
    })

    // No path artifact points back at this extrusion, so it answers to its own
    // id rather than to `pathId`.
    expect(f.setObjectsHidden).toHaveBeenCalledWith(
      new Map([['body-1', false]])
    )
    expect(f.setCameraToAxis).toHaveBeenCalledWith({
      axis: '-y',
      target: undefined,
      distance: undefined,
    })
    expect(activeViewSignal.value).toEqual({ name: 'Front', moduleKey: 'Main' })
  })

  it('sends no camera of its own for Default View', async () => {
    setFlag(true)
    const f = fakes()

    await activateNamedView({
      target: { kind: 'kclDefault' },
      kclManager: f.kclManager,
    })

    expect(f.setObjectsHidden).toHaveBeenCalledOnce()
    expect(f.setCameraToAxis).not.toHaveBeenCalled()
    expect(f.setCameraView).not.toHaveBeenCalled()
    expect(activeViewSignal.value).toBeNull()
  })
})

describe('the pre-activation camera', () => {
  beforeEach(() => {
    resetNamedViewSession()
    setFlag(true)
  })

  afterEach(() => {
    delete (window as unknown as { app?: unknown }).app
    resetNamedViewSession()
  })

  it('is put back by Default View', async () => {
    const f = fakes()

    await activateNamedView({
      target: { kind: 'declared', view: declaredView('Front') },
      kclManager: f.kclManager,
    })
    await activateNamedView({
      target: { kind: 'kclDefault' },
      kclManager: f.kclManager,
    })

    expect(f.getCameraView).toHaveBeenCalledOnce()
    expect(f.setCameraView).toHaveBeenCalledWith(SAVED_CAMERA)
  })

  it('is the one from before the first view, not before the second', async () => {
    const f = fakes()

    await activateNamedView({
      target: { kind: 'declared', view: declaredView('Front') },
      kclManager: f.kclManager,
    })
    await activateNamedView({
      target: { kind: 'declared', view: declaredView('Back') },
      kclManager: f.kclManager,
    })

    expect(f.getCameraView).toHaveBeenCalledOnce()
  })

  it('is not put back twice', async () => {
    const f = fakes()

    await activateNamedView({
      target: { kind: 'declared', view: declaredView('Front') },
      kclManager: f.kclManager,
    })
    await activateNamedView({
      target: { kind: 'kclDefault' },
      kclManager: f.kclManager,
    })
    await activateNamedView({
      target: { kind: 'kclDefault' },
      kclManager: f.kclManager,
    })

    expect(f.setCameraView).toHaveBeenCalledOnce()
  })
})

describe('reapplying the active view after an execution', () => {
  beforeEach(() => {
    resetNamedViewSession()
    setFlag(true)
    mockToast.error.mockClear()
  })

  afterEach(() => {
    delete (window as unknown as { app?: unknown }).app
    resetNamedViewSession()
  })

  it('reads the graph of the execution that just finished', async () => {
    const f = fakes()
    await activateFront(f)

    f.raw.execState = execStateWith({ bodies: ['body-1', 'body-2'] })
    f.engineSceneGenerationSignal.value += 1
    await flush()

    expect(f.setObjectsHidden).toHaveBeenCalledWith(
      new Map([
        ['body-1', false],
        ['body-2', false],
      ])
    )
  })

  it('sends no camera command', async () => {
    const f = fakes()
    await activateFront(f)

    f.engineSceneGenerationSignal.value += 1
    await flush()

    expect(f.setObjectsHidden).toHaveBeenCalledOnce()
    expect(f.setCameraToAxis).not.toHaveBeenCalled()
    expect(f.sendSceneCommand).not.toHaveBeenCalled()
  })

  it('does nothing when the execution reported errors', async () => {
    const f = fakes()
    await activateFront(f)

    f.raw.errors = [new Error('unresolved value')]
    f.raw.execState = execStateWith({ views: [] })
    f.engineSceneGenerationSignal.value += 1
    await flush()

    expect(f.setObjectsHidden).not.toHaveBeenCalled()
    expect(mockToast.error).not.toHaveBeenCalled()
    expect(activeViewSignal.value).toEqual({ name: 'Front', moduleKey: 'Main' })

    // The errors are what stopped it, not a missing effect.
    f.raw.errors = []
    f.raw.execState = execStateWith()
    f.engineSceneGenerationSignal.value += 1
    await flush()

    expect(f.setObjectsHidden).toHaveBeenCalledOnce()
  })

  it('does nothing while a version 1 sketch session is open', async () => {
    const f = fakes()
    await activateFront(f)

    f.raw.modelingState = modelingStateIn('Sketch')
    f.engineSceneGenerationSignal.value += 1
    await flush()

    expect(f.setObjectsHidden).not.toHaveBeenCalled()
    expect(activeViewSignal.value).toEqual({ name: 'Front', moduleKey: 'Main' })

    // The sketch session is what stopped it, not a missing effect.
    f.raw.modelingState = null
    f.engineSceneGenerationSignal.value += 1
    await flush()

    expect(f.setObjectsHidden).toHaveBeenCalledOnce()
  })

  it('does nothing while a version 2 sketch session is open', async () => {
    const f = fakes()
    await activateFront(f)

    f.raw.modelingState = modelingStateIn('sketchSolveMode')
    f.engineSceneGenerationSignal.value += 1
    await flush()

    expect(f.setObjectsHidden).not.toHaveBeenCalled()

    f.raw.modelingState = null
    f.engineSceneGenerationSignal.value += 1
    await flush()

    expect(f.setObjectsHidden).toHaveBeenCalledOnce()
  })

  /**
   * A sketch session must not turn a view off, only postpone reapplying it.
   * Dropping the view here would leave the user in a sketch with the scene
   * silently reverted and no toast explaining it.
   */
  it('keeps the active view when the view is gone but a sketch is open', async () => {
    const f = fakes()
    await activateFront(f)

    f.raw.modelingState = modelingStateIn('sketchSolveMode')
    f.raw.execState = execStateWith({ views: [] })
    f.engineSceneGenerationSignal.value += 1
    await flush()

    expect(f.setObjectsHidden).not.toHaveBeenCalled()
    expect(mockToast.error).not.toHaveBeenCalled()
    expect(activeViewSignal.value).toEqual({ name: 'Front', moduleKey: 'Main' })
  })

  it('does nothing once the flag is off', async () => {
    const f = fakes()
    await activateFront(f)

    setFlag(false)
    f.engineSceneGenerationSignal.value += 1
    await flush()

    expect(f.setObjectsHidden).not.toHaveBeenCalled()

    // The flag is what stopped it, not a missing effect.
    setFlag(true)
    f.engineSceneGenerationSignal.value += 1
    await flush()

    expect(f.setObjectsHidden).toHaveBeenCalledOnce()
  })

  it('does nothing for an exec state no execution produced', async () => {
    const f = fakes()
    await activateFront(f)

    // The shape a sketch-solve sync writes: a mock run over a program truncated
    // to the sketch block, so the views are missing and no command was sent.
    f.raw.execState = execStateWith({ views: [], bodies: [] })
    await flush()

    expect(f.setObjectsHidden).not.toHaveBeenCalled()
    expect(mockToast.error).not.toHaveBeenCalled()
    expect(activeViewSignal.value).toEqual({ name: 'Front', moduleKey: 'Main' })

    // The absent generation bump is what stopped it, not a missing effect.
    f.raw.execState = execStateWith()
    f.engineSceneGenerationSignal.value += 1
    await flush()

    expect(f.setObjectsHidden).toHaveBeenCalledOnce()
  })

  it('installs one effect however many views are activated', async () => {
    const f = fakes()
    await activateFront(f)

    await activateNamedView({
      target: { kind: 'declared', view: declaredView('Front') },
      kclManager: f.kclManager,
    })
    f.setObjectsHidden.mockClear()

    f.engineSceneGenerationSignal.value += 1
    await flush()

    expect(f.setObjectsHidden).toHaveBeenCalledOnce()
  })

  it('falls back to Default View, and says so, once the view is gone', async () => {
    const f = fakes()
    await activateFront(f)

    f.raw.execState = execStateWith({ views: ['Back'] })
    f.engineSceneGenerationSignal.value += 1
    await flush()

    expect(f.setObjectsHidden).toHaveBeenCalledWith(
      new Map([['body-1', false]])
    )
    expect(f.setCameraView).toHaveBeenCalledWith(SAVED_CAMERA)
    expect(activeViewSignal.value).toBeNull()
    expect(mockToast.error).toHaveBeenCalledOnce()
    expect(mockToast.error.mock.calls[0][0]).toContain('Front')
  })
})

describe('reapplying the active view after a reconnection', () => {
  beforeEach(() => {
    resetNamedViewSession()
    setFlag(true)
    mockToast.error.mockClear()
  })

  afterEach(() => {
    delete (window as unknown as { app?: unknown }).app
    resetNamedViewSession()
  })

  it('sends the camera as well as the visibility', async () => {
    const f = fakes()
    await activateFront(f)

    const movedTheCamera = await reapplyActiveViewAfterReconnect(f.kclManager)

    expect(movedTheCamera).toBe(true)
    expect(f.setObjectsHidden).toHaveBeenCalledWith(
      new Map([['body-1', false]])
    )
    expect(f.setCameraToAxis).toHaveBeenCalledWith({
      axis: '-y',
      target: undefined,
      distance: undefined,
    })
  })

  it('leaves the camera to the caller while Default View is active', async () => {
    const f = fakes()

    const movedTheCamera = await reapplyActiveViewAfterReconnect(f.kclManager)

    expect(movedTheCamera).toBe(false)
    expect(f.setObjectsHidden).not.toHaveBeenCalled()
    expect(f.setCameraToAxis).not.toHaveBeenCalled()
  })

  it('leaves the camera to the caller while a sketch session is open', async () => {
    const f = fakes()
    await activateFront(f)
    f.raw.modelingState = modelingStateIn('sketchSolveMode')

    const movedTheCamera = await reapplyActiveViewAfterReconnect(f.kclManager)

    expect(movedTheCamera).toBe(false)
    expect(f.setObjectsHidden).not.toHaveBeenCalled()
    expect(f.setCameraToAxis).not.toHaveBeenCalled()
    expect(activeViewSignal.value).toEqual({ name: 'Front', moduleKey: 'Main' })
  })

  it('leaves the camera to the caller while the flag is off', async () => {
    const f = fakes()
    await activateFront(f)
    setFlag(false)

    const movedTheCamera = await reapplyActiveViewAfterReconnect(f.kclManager)

    expect(movedTheCamera).toBe(false)
    expect(f.setObjectsHidden).not.toHaveBeenCalled()
  })

  it('falls back to Default View once the view is gone', async () => {
    const f = fakes()
    await activateFront(f)

    f.raw.execState = execStateWith({ views: [] })
    const movedTheCamera = await reapplyActiveViewAfterReconnect(f.kclManager)

    expect(movedTheCamera).toBe(true)
    expect(f.setCameraView).toHaveBeenCalledWith(SAVED_CAMERA)
    expect(f.setCameraToAxis).not.toHaveBeenCalled()
    expect(activeViewSignal.value).toBeNull()
    expect(mockToast.error).toHaveBeenCalledOnce()
  })
})
