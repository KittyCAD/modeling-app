import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

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

vi.mock('@src/lib/resetCameraPosition', () => ({
  resetCameraPosition: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@src/lib/isPlaywright', () => ({
  isPlaywright: () => false,
}))

import { signal } from '@preact/signals-core'
import type { ModulePath } from '@rust/kcl-lib/bindings/ModulePath'

import type { KclManager } from '@src/lang/KclManager'
import type { KclNamedView } from '@src/lang/std/kclNamedViews'
import type { Artifact, ExecState, KclNamedViewArtifact } from '@src/lang/wasm'
import { initialiseWasmNode } from '@src/lang/wasmUtilsNode'
import {
  activateNamedView,
  activeViewSignal,
  isSameView,
  isSketchSessionOpen,
  moduleKeyOf,
  reapplyActiveViewAfterReconnect,
  resetNamedViewSession,
  startTrackingActiveViewCamera,
} from '@src/lib/kclNamedViewActivation'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'
import { Signal } from '@src/lib/signal'
import { getKclDefaultViewName } from '@src/lib/wasm_lib_wrapper'
import { PerspectiveCamera, Vector3 } from 'three'

beforeAll(async () => {
  await initialiseWasmNode()
})

beforeEach(() => {
  vi.mocked(resetCameraPosition).mockClear()
})

const MAIN_PATH: ModulePath = { type: 'Main' }

const CODE_REF = {
  range: [0, 0, 0] as [number, number, number],
  nodePath: { steps: [] },
  pathToNode: [],
}

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

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function fakes({ isReady = true }: { isReady?: boolean } = {}) {
  const setObjectsHidden = vi.fn().mockResolvedValue(null)
  const setCameraToAxis = vi.fn().mockResolvedValue(undefined)
  const zoomToFit = vi.fn().mockResolvedValue(undefined)
  const viewIsometric = vi.fn().mockResolvedValue(undefined)
  const setCameraProjection = vi.fn().mockResolvedValue(undefined)
  const engineSceneGenerationSignal = signal(0)
  const modelingStateSignal = signal<ModelingStateFake>(null)
  const camera = new PerspectiveCamera()
  camera.position.z = 1

  const raw = {
    systemDeps: {
      settings: {
        getSnapshot: () => ({
          context: {
            modeling: { cameraProjection: { current: 'orthographic' } },
          },
        }),
      },
    },
    execState: execStateWith(),
    errors: [] as unknown[],
    get modelingState() {
      return modelingStateSignal.value
    },
    set modelingState(state: ModelingStateFake) {
      modelingStateSignal.value = state
    },
    modelingStateSignal,
    engineSceneGenerationSignal,
    engineCommandManager: { setObjectsHidden, isReady },
    sceneInfra: {
      camControls: {
        setCameraToAxis,
        setCameraProjection,
        zoomToFit,
        viewIsometric,
        target: new Vector3(),
        camera,
        cameraChange: new Signal(),
      },
    },
  }

  return {
    raw,
    kclManager: raw as unknown as KclManager,
    setObjectsHidden,
    setCameraToAxis,
    zoomToFit,
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
  f.zoomToFit.mockClear()
}

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
    expect(isSameView('kclDefault', 'kclDefault')).toBe(true)
    expect(isSameView('kclDefault', null)).toBe(false)
    expect(isSameView('kclDefault', { name: 'Front', moduleKey: 'Main' })).toBe(
      false
    )
    expect(isSameView({ name: 'Front', moduleKey: 'Main' }, 'kclDefault')).toBe(
      false
    )
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
    resetNamedViewSession()
  })

  it('sends nothing while a command would not reach the engine', async () => {
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

  it('sends every newly nameable artifact kind to the engine', async () => {
    const f = fakes()
    const artifacts: Artifact[] = [
      {
        type: 'plane',
        id: 'plane-1',
        pathIds: [],
        codeRef: CODE_REF,
      },
      {
        type: 'helix',
        id: 'helix-1',
        axisId: null,
        trajectorySweepId: null,
        consumed: false,
        codeRef: CODE_REF,
      },
      {
        type: 'importedGeometry',
        id: 'imported-1',
        consumed: false,
        codeRef: CODE_REF,
      },
    ]
    for (const artifact of artifacts) {
      f.raw.execState.artifactGraph.set(artifact.id, artifact)
    }

    await activateNamedView({
      target: { kind: 'declared', view: declaredView('Front') },
      kclManager: f.kclManager,
    })

    expect(f.setObjectsHidden).toHaveBeenCalledWith(
      new Map([
        ['body-1', false],
        ['plane-1', false],
        ['helix-1', false],
        ['imported-1', false],
      ])
    )
  })

  it('restores KCL visibility after camera movement without resetting the camera', async () => {
    const f = fakes()
    f.raw.execState = execStateWith({ bodies: ['body-1', 'body-2'] })
    f.raw.execState.operations = {
      map: {
        0: [
          {
            type: 'StdLibCall',
            name: 'hide',
            unlabeledArg: {
              value: { type: 'Solid', value: { artifactId: 'body-1' } },
              sourceRange: CODE_REF.range,
            },
            labeledArgs: {},
            nodePath: CODE_REF.nodePath,
            sourceRange: CODE_REF.range,
          },
        ],
      },
    }
    await activateFront(f)
    const controls = f.raw.sceneInfra.camControls

    controls.cameraChange.dispatch()
    expect(activeViewSignal.value).toEqual({ name: 'Front', moduleKey: 'Main' })
    expect(f.setObjectsHidden).not.toHaveBeenCalled()

    controls.camera.position.x += 1
    controls.cameraChange.dispatch()
    await flush()
    expect(activeViewSignal.value).toBeNull()
    expect(resetCameraPosition).not.toHaveBeenCalled()
    expect(f.setCameraToAxis).not.toHaveBeenCalled()
    expect(f.setObjectsHidden).toHaveBeenCalledExactlyOnceWith(
      new Map([
        ['body-1', true],
        ['body-2', false],
      ])
    )

    // Reconnect can start tracking again when no named view is active.
    startTrackingActiveViewCamera(f.kclManager)
    controls.camera.position.x += 1
    controls.cameraChange.dispatch()
    await flush()
    expect(f.setObjectsHidden).toHaveBeenCalledOnce()

    await activateNamedView({
      target: { kind: 'kclDefault' },
      kclManager: f.kclManager,
    })
    expect(resetCameraPosition).toHaveBeenCalledOnce()
    expect(activeViewSignal.value).toBe('kclDefault')
    f.setObjectsHidden.mockClear()

    controls.camera.zoom *= 2
    controls.cameraChange.dispatch()
    await flush()
    expect(activeViewSignal.value).toBeNull()
    expect(resetCameraPosition).toHaveBeenCalledOnce()
    expect(f.setObjectsHidden).toHaveBeenCalledExactlyOnceWith(
      new Map([
        ['body-1', true],
        ['body-2', false],
      ])
    )
  })

  it('keeps a view active while applying its camera and reconnecting', async () => {
    const f = fakes()
    const controls = f.raw.sceneInfra.camControls
    f.setCameraToAxis.mockImplementation(async () => {
      controls.camera.position.x += 1
      controls.cameraChange.dispatch()
    })
    await activateFront(f)
    await activateFront(f)
    await reapplyActiveViewAfterReconnect(f.kclManager)
    expect(activeViewSignal.value).toEqual({ name: 'Front', moduleKey: 'Main' })

    controls.camera.zoom *= 2
    controls.cameraChange.dispatch()
    expect(activeViewSignal.value).toBeNull()
  })

  it('restores KCL visibility and the preferred projection for Default View', async () => {
    const { resetCameraPosition: resetCamera } = await vi.importActual<{
      resetCameraPosition: typeof resetCameraPosition
    }>('@src/lib/resetCameraPosition')
    vi.mocked(resetCameraPosition).mockImplementationOnce(resetCamera)
    const f = fakes()

    await activateNamedView({
      target: { kind: 'kclDefault' },
      kclManager: f.kclManager,
    })

    expect(f.setObjectsHidden).toHaveBeenCalledWith(
      new Map([['body-1', false]])
    )
    expect(f.setCameraToAxis).not.toHaveBeenCalled()
    expect(
      f.raw.sceneInfra.camControls.setCameraProjection
    ).toHaveBeenCalledWith('orthographic')
    expect(activeViewSignal.value).toBe('kclDefault')
  })
})

describe('reapplying the active view after an execution', () => {
  beforeEach(() => {
    resetNamedViewSession()
    mockToast.error.mockClear()
  })

  afterEach(() => {
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
    expect(f.zoomToFit).not.toHaveBeenCalled()
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

  it('waits for a version 1 sketch session to close', async () => {
    const f = fakes()
    await activateFront(f)

    f.raw.modelingState = modelingStateIn('Sketch')
    f.engineSceneGenerationSignal.value += 1
    await flush()

    expect(f.setObjectsHidden).not.toHaveBeenCalled()
    expect(activeViewSignal.value).toEqual({ name: 'Front', moduleKey: 'Main' })

    // Closing the session applies the rebuild it postponed, with no new run.
    f.raw.modelingState = null
    await flush()

    expect(f.setObjectsHidden).toHaveBeenCalledOnce()
  })

  it('waits for a version 2 sketch session to close', async () => {
    const f = fakes()
    await activateFront(f)

    f.raw.modelingState = modelingStateIn('sketchSolveMode')
    f.engineSceneGenerationSignal.value += 1
    await flush()

    expect(f.setObjectsHidden).not.toHaveBeenCalled()

    // Exiting sketch mode rebuilds the scene before the session closes, and the
    // executions after it are cache hits that leave the generation alone.
    f.raw.modelingState = null
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
    expect(resetCameraPosition).toHaveBeenCalledOnce()
    expect(activeViewSignal.value).toBe('kclDefault')
    expect(mockToast.error).toHaveBeenCalledOnce()
    expect(mockToast.error.mock.calls[0][0]).toContain('Front')
    expect(mockToast.error.mock.calls[0][0]).toContain(getKclDefaultViewName())
  })
})

describe('reapplying the active view after a reconnection', () => {
  beforeEach(() => {
    resetNamedViewSession()
    mockToast.error.mockClear()
  })

  afterEach(() => {
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

  it('restores visibility without replacing a preserved reconnect camera', async () => {
    const f = fakes()
    await activateFront(f)
    f.setCameraToAxis.mockClear()
    const moved = await reapplyActiveViewAfterReconnect(f.kclManager, {
      restoreCamera: false,
    })
    expect(moved).toBe(false)
    expect(f.setObjectsHidden).toHaveBeenCalledWith(
      new Map([['body-1', false]])
    )
    expect(f.setCameraToAxis).not.toHaveBeenCalled()
    expect(resetCameraPosition).not.toHaveBeenCalled()
  })

  it('keeps the preserved camera when an active named view disappears', async () => {
    const f = fakes()
    await activateFront(f)
    const cameraChange = f.raw.sceneInfra.camControls.cameraChange
    const subscribe = vi.spyOn(cameraChange, 'add')
    const unsubscribe = vi.spyOn(cameraChange, 'remove')
    f.raw.execState = execStateWith({ views: [] })
    const moved = await reapplyActiveViewAfterReconnect(f.kclManager, {
      restoreCamera: false,
    })
    expect(moved).toBe(false)
    expect(resetCameraPosition).not.toHaveBeenCalled()
    expect(activeViewSignal.value).toBeNull()
    expect(subscribe).not.toHaveBeenCalled()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(mockToast.error).toHaveBeenCalledOnce()
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

  it('falls back to Default View once the view is gone', async () => {
    const f = fakes()
    await activateFront(f)

    f.raw.execState = execStateWith({ views: [] })
    const movedTheCamera = await reapplyActiveViewAfterReconnect(f.kclManager)

    expect(movedTheCamera).toBe(true)
    expect(resetCameraPosition).toHaveBeenCalledOnce()
    expect(f.setCameraToAxis).not.toHaveBeenCalled()
    expect(activeViewSignal.value).toBe('kclDefault')
    expect(mockToast.error).toHaveBeenCalledOnce()
  })
})
