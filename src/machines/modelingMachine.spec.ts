/** Machine and swept-face integration tests. Legacy sketch edits run offline
 * in modelingMachine.legacySketch.spec.ts. */
import type { SceneGraphDelta } from '@rust/kcl-lib/bindings/FrontendApi'
import { STRAIGHT_SEGMENT } from '@src/clientSideScene/sceneConstants'
import type { KclManager } from '@src/lang/KclManager'
import { getWallCodeRef } from '@src/lang/std/artifactGraph'
import { type Artifact, type ArtifactGraph, assertParse } from '@src/lang/wasm'
import type { MachineManager } from '@src/lib/MachineManager'
import type { ModelingCommandSchema } from '@src/lib/commandBarConfigs/modelingCommandConfig'
import type RustContext from '@src/lib/rustContext'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { getAstAndArtifactGraph } from '@src/lib/testHelpers'
import { StepSchema } from '@src/lib/stepSchema'
import { isErr } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { CommandBarActorType } from '@src/machines/commandBarMachine'
import {
  modelingMachine,
  positionLocalSketchSolveCamera,
} from '@src/machines/modelingMachine'
import {
  dummyInitSketchGraphDelta,
  generateModelingMachineDefaultContext,
  modelingMachineInitialInternalContext,
} from '@src/machines/modelingSharedContext'
import type {
  DefaultPlane,
  ExtrudeFacePlane,
  OffsetPlane,
} from '@src/machines/modelingSharedTypes'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import {
  buildTheWorldAndConnectToEngine,
  buildTheWorldAndNoEngineConnection,
  createProjectForTest,
} from '@src/unitTestUtils'
import toast from 'react-hot-toast'
import { Group } from 'three'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { createActor, fromPromise, toPromise, waitFor } from 'xstate'

const GLOBAL_TIMEOUT_FOR_MODELING_MACHINE = 5000

let instanceInThisFile: ModuleType = null!
let kclManagerInThisFile: KclManager = null!
let engineCommandManagerInThisFile: ConnectionManager = null!
let rustContextInThisFile: RustContext = null!
let commandBarActorInThisFile: CommandBarActorType = null!
let machineManagerInThisFile: MachineManager = null!

type TestWorld = Pick<
  Awaited<ReturnType<typeof buildTheWorldAndNoEngineConnection>>,
  | 'instance'
  | 'kclManager'
  | 'engineCommandManager'
  | 'rustContext'
  | 'commandBarActor'
  | 'machineManager'
>
let worldWithoutEngine: TestWorld

function setTestWorld(world: TestWorld) {
  instanceInThisFile = world.instance
  kclManagerInThisFile = world.kclManager
  engineCommandManagerInThisFile = world.engineCommandManager
  rustContextInThisFile = world.rustContext
  commandBarActorInThisFile = world.commandBarActor
  machineManagerInThisFile = world.machineManager
}

/**
 * Keep engine sessions scoped to the describe blocks that need them. A single
 * session for this whole file can expire before the shuffled tests finish.
 */
function useEngineWorld() {
  beforeAll(async () => {
    setTestWorld(
      await buildTheWorldAndConnectToEngine({
        webrtc: false,
      })
    )
  })

  afterAll(() => {
    engineCommandManagerInThisFile.tearDown({
      route: 'user-requested',
      initiatedBy: 'client',
    })
    setTestWorld(worldWithoutEngine)
  })
}

beforeAll(async () => {
  worldWithoutEngine = await buildTheWorldAndNoEngineConnection()
  setTestWorld(worldWithoutEngine)
})

describe('sketch entry on swept sketch-block faces', () => {
  useEngineWorld()

  it.each([
    { face: 'top', start: '[0mm, 2mm]', normal: 1 },
    { face: 'bottom', start: '[3mm, -2mm]', normal: -1 },
  ])(
    'starts a sketch on the $face face',
    async ({ face, start, normal }) => {
      const code = `@settings(defaultLengthUnit = mm, kclVersion = 3.0)
profile = sketch(on = XZ) {
  left = line(start = [0mm, -2mm], end = [0mm, 2mm])
  top = line(start = [0mm, 2mm], end = [3mm, 2mm])
  right = line(start = [3mm, 2mm], end = [3mm, -2mm])
  bottom = line(start = [3mm, -2mm], end = [0mm, -2mm])
}
path = sketch(on = XY) {
  arc1 = arc(start = [0mm, 0mm], end = [20mm, 20mm], center = [20mm, 0mm], direction = CW)
}
body = profile |> sweep(path = path)
`
      const { artifactGraph } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      expect(kclManagerInThisFile.errors).toEqual([])
      const segmentStart = code.indexOf(`line(start = ${start}`)
      const wall = [...artifactGraph.values()].find((artifact) => {
        if (artifact.type !== 'wall') return false
        const source = getWallCodeRef(artifact, artifactGraph)
        return !isErr(source) && source.range[0] === segmentStart
      })
      if (!wall) throw new Error(`Missing ${face} sweep face`)

      const implementation =
        modelingMachine.implementations.actors['animate-to-sketch-solve']
      const logic =
        'src' in implementation ? implementation.src : implementation
      const actor = createActor(logic, {
        input: {
          artifactOrPlaneId: wall.id,
          kclManager: kclManagerInThisFile,
          rustContext: rustContextInThisFile,
          engineCommandManager: engineCommandManagerInThisFile,
          wasmInstance: instanceInThisFile,
          projectRef: { current: createProjectForTest() },
        },
      })
      try {
        const done = toPromise(actor)
        actor.start()
        const result = await done
        expect(result.plane.zAxis[2]).toBeCloseTo(normal)
        expect(kclManagerInThisFile.code).toContain(
          `face001 = faceOf(body, face = ${face})`
        )
        expect(kclManagerInThisFile.code).toContain(
          'sketch001 = sketch(on = face001)'
        )
        expect(result.initialSceneGraphDelta.exec_outcome?.issues).toEqual([])

        const reloaded = await rustContextInThisFile.hackSetProgram(
          assertParse(kclManagerInThisFile.code, instanceInThisFile),
          jsAppSettings(rustContextInThisFile.settingsActor)
        )
        expect(reloaded.type).toBe('Success')
        if (reloaded.type === 'Success') {
          expect(reloaded.execOutcome.issues).toEqual([])
        }
      } finally {
        actor.stop()
      }
    },
    15_000
  )
})

describe('STEP schema export requests', () => {
  async function exportFormat(data: ModelingCommandSchema['Export']) {
    const world = worldWithoutEngine
    const program = assertParse(
      '@settings(kclVersion = 3.0)\nvalue = 1',
      world.instance
    )
    const hasErrors = vi
      .spyOn(world.kclManager, 'hasErrors')
      .mockReturnValue(false)
    const ast = vi
      .spyOn(world.kclManager, 'ast', 'get')
      .mockReturnValue(program)
    const exportRequest = vi
      .spyOn(world.rustContext, 'export')
      .mockResolvedValue(undefined)
    const loading = vi
      .spyOn(toast, 'loading')
      .mockReturnValue('schema-export-test')
    const implementation =
      modelingMachine.implementations.actors.exportFromEngine
    const logic = 'src' in implementation ? implementation.src : implementation
    const actor = createActor(logic, {
      input: {
        data,
        kclManager: world.kclManager,
        rustContext: world.rustContext,
        fileName: 'model.step',
      },
    })
    try {
      const done = toPromise(actor)
      actor.start()
      await done
      expect(exportRequest).toHaveBeenCalledOnce()
      return exportRequest.mock.calls[0]?.[0]
    } finally {
      actor.stop()
      loading.mockRestore()
      exportRequest.mockRestore()
      ast.mockRestore()
      hasErrors.mockRestore()
    }
  }

  const schemas: ModelingCommandSchema['Export']['schema'][] = [
    ...Object.values(StepSchema),
    undefined,
  ]
  it.each(schemas)(
    'requests schema %s while preserving export units and orientation',
    async (schema) => {
      expect(
        await exportFormat({ type: 'step', schema, up: 'y', scale: 'in' })
      ).toEqual({
        type: 'step',
        schema: schema ?? 'ap242',
        units: 'in',
        coords: {
          forward: { axis: 'z', direction: 'positive' },
          up: { axis: 'y', direction: 'positive' },
        },
        views: {},
      })
    }
  )

  const otherFormats: ModelingCommandSchema['Export']['type'][] = [
    'gltf',
    'obj',
    'stl',
    'ply',
    'fbx',
  ]
  it.each(otherFormats)(
    'omits a stale STEP schema when exporting %s',
    async (type) => {
      const format = await exportFormat({ type, schema: StepSchema.Ap214 })
      expect(format).toMatchObject({ type })
      expect(format).not.toHaveProperty('schema')
    }
  )
})

describe('modelingMachine.test.ts', () => {
  // Define mock implementations that will be referenced in vi.mock calls
  vi.mock('@src/components/SetHorVertDistanceModal', () => ({
    createInfoModal: vi.fn(() => ({
      open: vi.fn().mockResolvedValue({
        value: '10',
        segName: 'test',
        valueNode: {},
        newVariableInsertIndex: 0,
        sign: 1,
      }),
    })),
    GetInfoModal: vi.fn(),
  }))

  vi.mock('@src/components/SetAngleLengthModal', () => ({
    createSetAngleLengthModal: vi.fn(() => ({
      open: vi.fn().mockResolvedValue({
        value: '45deg',
        segName: 'test',
        valueNode: {},
        newVariableInsertIndex: 0,
        sign: 1,
      }),
    })),
    SetAngleLengthModal: vi.fn(),
  }))

  const toastErrorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '')

  // Add this function before the test cases
  // Utility function to wait for a condition to be met
  const waitForCondition = async (
    condition: () => boolean,
    timeout = GLOBAL_TIMEOUT_FOR_MODELING_MACHINE,
    interval = 100
  ) => {
    const startTime = Date.now()

    while (Date.now() - startTime < timeout) {
      try {
        if (condition()) {
          return true
        }
      } catch {
        // Ignore errors, keep polling
      }

      // Wait for the next interval
      await new Promise((resolve) => setTimeout(resolve, interval))
    }

    // Last attempt before failing
    return condition()
  }

  describe('modelingMachine - XState', () => {
    describe('legacy overlay pointer retention', () => {
      function createOverlayActor() {
        const input = generateModelingMachineDefaultContext({
          kclManager: kclManagerInThisFile,
          rustContext: rustContextInThisFile,
          wasmInstance: instanceInThisFile,
          engineCommandManager: engineCommandManagerInThisFile,
          commandBarActor: commandBarActorInThisFile,
          machineManager: machineManagerInThisFile,
        })
        const actor = createActor(modelingMachine, { input }).start()
        const group = new Group()
        group.userData = { type: STRAIGHT_SEGMENT, pathToNode: [] }
        return { actor, group, key: '[]' }
      }

      it('shows immediately and retains controls while the pointer crosses their gap', () => {
        vi.useFakeTimers()
        const { actor, group, key } = createOverlayActor()
        const scene = kclManagerInThisFile.sceneInfra
        const previousSend = scene.modelingSend
        scene.setSend((event) => actor.send(event))
        try {
          actor.send({
            type: 'Set mouse state',
            data: { type: 'isHovering', on: group },
          })
          expect(actor.getSnapshot().context.segmentHoverMap[key]).toBe(0)
          actor.send({ type: 'Set mouse state', data: { type: 'idle' } })
          const retained = actor.getSnapshot().context.segmentHoverMap[key]
          expect(retained).toBeDefined()
          vi.advanceTimersByTime(500)
          expect(actor.getSnapshot().context.segmentHoverMap[key]).toBe(
            retained
          )
          actor.send({
            type: 'Set mouse state',
            data: { type: 'isHovering', on: group },
          })
          vi.advanceTimersByTime(1500)
          expect(actor.getSnapshot().context.segmentHoverMap[key]).toBe(0)
          actor.send({ type: 'Set mouse state', data: { type: 'idle' } })
          vi.advanceTimersByTime(1000)
          expect(
            actor.getSnapshot().context.segmentHoverMap[key]
          ).toBeUndefined()
        } finally {
          actor.stop()
          scene.setSend(previousSend)
          vi.clearAllTimers()
          vi.useRealTimers()
        }
      })

      it('cannot remove a replacement actor toolbar with the same segment key', () => {
        vi.useFakeTimers()
        const retired = createOverlayActor()
        const scene = kclManagerInThisFile.sceneInfra
        const previousSend = scene.modelingSend
        scene.setSend((event) => retired.actor.send(event))
        retired.actor.send({
          type: 'Set mouse state',
          data: { type: 'isHovering', on: retired.group },
        })
        retired.actor.send({ type: 'Set mouse state', data: { type: 'idle' } })
        retired.actor.stop()
        const current = createOverlayActor()
        scene.setSend((event) => current.actor.send(event))
        try {
          current.actor.send({
            type: 'Set mouse state',
            data: { type: 'isHovering', on: current.group },
          })
          vi.advanceTimersByTime(1500)
          expect(
            current.actor.getSnapshot().context.segmentHoverMap[current.key]
          ).toBe(0)
        } finally {
          current.actor.stop()
          scene.setSend(previousSend)
          vi.clearAllTimers()
          vi.useRealTimers()
        }
      })

      it('does not publish an old file timeout after the editor switches files', () => {
        vi.useFakeTimers()
        const { actor, group, key } = createOverlayActor()
        const scene = kclManagerInThisFile.sceneInfra
        const previousSend = scene.modelingSend
        const previousPath = kclManagerInThisFile.path
        scene.setSend((event) => actor.send(event))
        try {
          actor.send({
            type: 'Set mouse state',
            data: { type: 'isHovering', on: group },
          })
          actor.send({ type: 'Set mouse state', data: { type: 'idle' } })
          const retained = actor.getSnapshot().context.segmentHoverMap[key]
          kclManagerInThisFile.path = 'another-overlay-file.kcl'
          vi.advanceTimersByTime(1500)
          expect(actor.getSnapshot().context.mouseState.type).toBe('idle')
          expect(actor.getSnapshot().context.segmentHoverMap[key]).toBe(
            retained
          )
        } finally {
          actor.stop()
          kclManagerInThisFile.path = previousPath
          scene.setSend(previousSend)
          vi.clearAllTimers()
          vi.useRealTimers()
        }
      })
    })

    describe('when initialized', () => {
      it('should start in the idle state', async () => {
        const contextCopied = generateModelingMachineDefaultContext({
          kclManager: kclManagerInThisFile,
          rustContext: rustContextInThisFile,
          wasmInstance: instanceInThisFile,
          engineCommandManager: engineCommandManagerInThisFile,
          commandBarActor: commandBarActorInThisFile,
          machineManager: machineManagerInThisFile,
        })
        contextCopied.engineCommandManager = engineCommandManagerInThisFile
        contextCopied.commandBarActor = commandBarActorInThisFile

        const actor = createActor(modelingMachine, {
          input: contextCopied,
        }).start()
        const state = actor.getSnapshot().value

        // The machine should start in the idle state
        expect(state).toEqual({ idle: 'hidePlanes' })
      })
    })

    // Legacy segment editing matrices run offline in modelingMachine.legacySketch.spec.ts.

    describe('selection synchronization', () => {
      it('synchronizes default plane selection with the engine and editor', () => {
        const code = 'body001 = extrude(region001, length = 10)'
        const dispatch = vi.fn()
        const sendSceneCommand = vi.fn().mockResolvedValue(undefined)
        const context = {
          ...modelingMachineInitialInternalContext,
          selectionRanges: {
            graphSelections: [
              {
                entityRef: { type: 'solid3d', solid3d_id: 'body-id' },
                codeRef: { range: [0, code.length, 0], pathToNode: [] },
              },
            ],
            otherSelections: [],
          },
          kclManager: {
            artifactGraph: new Map(),
            ast: { body: [] },
            code,
            editorView: { dispatch },
            hidePlanes: vi.fn().mockResolvedValue(undefined),
            isShiftDown: false,
            sceneEntitiesManager: { activeSegments: {} },
            sceneInfra: {
              resetMouseListeners: vi.fn(),
              setCallbacks: vi.fn(),
              camControls: {
                cancelSketchCameraTransition: vi.fn(),
                enablePan: true,
                enableRotate: true,
                syncDirection: 'engineToClient',
              },
            },
          },
          rustContext: {},
          engineCommandManager: {
            connection: { pingIntervalId: 1 },
            sendSceneCommand,
          },
          wasmInstance: {},
          commandBarActor: {},
          machineManager: {},
        } as any
        const actor = createActor(modelingMachine, { input: context }).start()

        actor.send({
          type: 'Set selection',
          data: {
            selectionType: 'defaultPlaneSelection',
            selection: { name: 'XY', id: 'xy-plane-id' },
          },
        })

        expect(actor.getSnapshot().context.selectionRanges).toEqual({
          graphSelections: [],
          otherSelections: [{ name: 'XY', id: 'xy-plane-id' }],
        })
        expect(dispatch).toHaveBeenCalledWith({
          selection: expect.objectContaining({
            main: expect.objectContaining({ head: code.length }),
          }),
        })
        expect(sendSceneCommand.mock.calls.map(([event]) => event.cmd)).toEqual(
          [
            { type: 'select_clear' },
            { type: 'select_add', entities: ['xy-plane-id'] },
          ]
        )

        sendSceneCommand.mockClear()

        actor.send({
          type: 'Set selection',
          data: {
            selectionType: 'singleCodeCursor',
            selection: {
              entityRef: { type: 'solid3d', solid3d_id: 'body-id' },
              codeRef: {
                range: [0, code.length, 0],
                pathToNode: [],
              },
            },
          },
        })

        expect(actor.getSnapshot().context.selectionRanges).toEqual({
          graphSelections: [
            {
              entityRef: { type: 'solid3d', solid3d_id: 'body-id' },
              codeRef: {
                range: [0, code.length, 0],
                pathToNode: [],
              },
            },
          ],
          otherSelections: [],
        })
        expect(sendSceneCommand.mock.calls.map(([event]) => event.cmd)).toEqual(
          [
            {
              type: 'select_entity',
              entities: [{ type: 'solid3d', solid3d_id: 'body-id' }],
            },
          ]
        )

        actor.stop()
      })
    })

    describe('modelingMachine sketch entry', () => {
      const invalidCode = `@settings(experimentalFeatures = allow)

sketch001 = sketch(on = YZ) {
  line1 = line(start = [var -4.23mm, var 0.9mm], end = [var 2.98mm, var 3.19mm])
  line2 = line(start = [var 2.98mm, var 3.19mm], end = [var 3.57mm, var -4.02mm])
  coincident([line1.end line2.start])
}`
      it('keeps invalid code intact when sketch creation is attempted with parse errors', async () => {
        const {
          instance,
          kclManager,
          rustContext,
          engineCommandManager,
          commandBarActor,
          machineManager,
        } = await buildTheWorldAndNoEngineConnection()

        kclManager.updateCodeEditor(invalidCode)
        const parseResult = await kclManager.safeParse(invalidCode)

        expect(parseResult).toBeNull()
        expect(kclManager.hasParseErrors()).toBe(true)

        const newSketchSpy = vi.spyOn(rustContext, 'newSketch')

        const context = generateModelingMachineDefaultContext({
          kclManager,
          rustContext,
          wasmInstance: instance,
          engineCommandManager,
          commandBarActor,
          machineManager,
        })
        context.store.defaultUnit = { current: 'mm' } as any
        context.projectRef = { current: {} as any }

        const actor = createActor(modelingMachine, {
          input: context as any,
        }).start()

        actor.send({ type: 'Enter sketch' })
        actor.send({
          type: 'Select sketch solve plane',
          data: 'test-plane-id',
        })

        await waitForCondition(() => toastErrorSpy.mock.calls.length > 0)
        await waitForCondition(
          () => actor.getSnapshot().value === 'Sketch no face'
        )

        expect(newSketchSpy).not.toHaveBeenCalled()
        expect(kclManager.code).toBe(invalidCode)
        expect(actor.getSnapshot().value).toBe('Sketch no face')
        expect(toastErrorSpy).toHaveBeenCalledWith(
          'Unable to enter sketch while KCL has parse errors.'
        )
      })

      it('routes a cursor inside a sketch block segment to sketch solve edit', async () => {
        const pathToNode = [['body', '']] as any
        const sketchBlockCodeRef = {
          range: [0, 100, 0] as [number, number, number],
          pathToNode,
          nodePath: { steps: [] },
        }
        const segmentCodeRef = {
          range: [35, 85, 0] as [number, number, number],
          pathToNode,
          nodePath: { steps: [] },
        }
        const sketchBlock: Extract<Artifact, { type: 'sketchBlock' }> = {
          type: 'sketchBlock',
          id: 'sketch-block-1',
          codeRef: sketchBlockCodeRef,
          planeId: 'plane-1',
          sketchId: 7,
        }
        const path: Artifact = {
          type: 'path',
          subType: 'sketch',
          id: 'path-1',
          codeRef: sketchBlockCodeRef,
          planeId: 'plane-1',
          segIds: ['segment-1'],
          trajectorySweepId: null,
          consumed: false,
          sketchBlockId: sketchBlock.id,
        }
        const segment: Artifact = {
          type: 'segment',
          id: 'segment-1',
          pathId: path.id,
          edgeIds: [],
          commonSurfaceIds: [],
          codeRef: segmentCodeRef,
        }
        const artifactGraph: ArtifactGraph = new Map()
        artifactGraph.set(sketchBlock.id, sketchBlock)
        artifactGraph.set(path.id, path)
        artifactGraph.set(segment.id, segment)

        const context = {
          ...modelingMachineInitialInternalContext,
          selectionRanges: {
            graphSelections: [
              {
                artifact: segment,
                codeRef: {
                  range: [45, 45, 0],
                  pathToNode,
                },
              },
            ],
            otherSelections: [],
          },
          kclManager: {
            artifactGraph,
            hidePlanes: vi.fn().mockResolvedValue(undefined),
            showPlanes: vi.fn().mockResolvedValue(undefined),
            sceneInfra: {
              animate: vi.fn(),
              resetMouseListeners: vi.fn(),
              setCallbacks: vi.fn(),
              camControls: {
                cancelSketchCameraTransition: vi.fn(),
                enablePan: true,
                enableRotate: true,
                syncDirection: 'engineToClient',
              },
            },
          },
          rustContext: {},
          engineCommandManager: {},
          wasmInstance: {},
          commandBarActor: {},
          machineManager: {},
        } as any

        let receivedInput: any
        let actorStarted = false
        const machine = modelingMachine.provide({
          actors: {
            'animate-to-existing-sketch-solve': fromPromise(
              async ({ input }) => {
                receivedInput = input
                actorStarted = true
                return await new Promise<any>(() => {})
              }
            ),
          },
        })

        const actor = createActor(machine, { input: context }).start()

        actor.send({ type: 'Enter sketch' })

        await waitForCondition(() => actorStarted)

        expect(actor.getSnapshot().value).toBe(
          'animating to existing sketch solve'
        )
        expect(receivedInput).toEqual(
          expect.objectContaining({
            artifactId: sketchBlock.id,
          })
        )

        actor.stop()
      })

      const createSketchPlaneSelectionContext = ({
        artifactGraph = new Map(),
      }: {
        artifactGraph?: Map<unknown, unknown>
      } = {}) => ({
        ...modelingMachineInitialInternalContext,
        kclManager: {
          artifactGraph,
          hasErrors: vi.fn(() => false),
          hidePlanes: vi.fn().mockResolvedValue(undefined),
          setCopilotEnabled: vi.fn(),
          setSelectionFilter: vi.fn(),
          setSelectionFilterToDefault: vi.fn(),
          showPlanes: vi.fn().mockResolvedValue(undefined),
          sceneInfra: {
            animate: vi.fn(),
            stop: vi.fn(),
            resetMouseListeners: vi.fn(),
            setCallbacks: vi.fn(),
            camControls: {
              cancelSketchCameraTransition: vi.fn(),
              enablePan: true,
              enableRotate: true,
              syncDirection: 'engineToClient',
            },
          },
        },
        rustContext: {},
        engineCommandManager: {},
        wasmInstance: {},
        commandBarActor: {},
        machineManager: {},
      })

      it('shows default planes again when canceling sketch plane selection on a blank scene', async () => {
        const context = createSketchPlaneSelectionContext()

        const actor = createActor(modelingMachine, {
          input: context as any,
        }).start()

        actor.send({
          type: 'Enter sketch',
          data: { forceNewSketch: true },
        })

        await waitForCondition(
          () => actor.getSnapshot().value === 'Sketch no face'
        )

        actor.send({ type: 'Cancel' })

        await waitForCondition(() => {
          return (
            JSON.stringify(actor.getSnapshot().value) ===
            JSON.stringify({ idle: 'showPlanes' })
          )
        })

        expect(context.kclManager.hidePlanes).toHaveBeenCalled()
        expect(context.kclManager.showPlanes).toHaveBeenCalledTimes(2)

        actor.stop()
      })

      it('hides default planes when canceling sketch plane selection with geometry present', async () => {
        const context = {
          ...createSketchPlaneSelectionContext({
            artifactGraph: new Map([['artifact-id', {}]]),
          }),
        }

        const actor = createActor(modelingMachine, {
          input: context as any,
        }).start()

        actor.send({
          type: 'Enter sketch',
          data: { forceNewSketch: true },
        })

        await waitForCondition(
          () => actor.getSnapshot().value === 'Sketch no face'
        )

        actor.send({ type: 'Cancel' })

        await waitForCondition(() => {
          return (
            JSON.stringify(actor.getSnapshot().value) ===
            JSON.stringify({ idle: 'hidePlanes' })
          )
        })

        expect(context.kclManager.hidePlanes).toHaveBeenCalled()
        expect(context.kclManager.showPlanes).toHaveBeenCalledTimes(1)

        actor.stop()
      })
    })

    it.each<{ projection: 'perspective' | 'orthographic' }>([
      { projection: 'perspective' },
      { projection: 'orthographic' },
    ])(
      'exits a disposed sketch when the disconnected engine cannot restore $projection',
      async ({ projection }) => {
        const {
          instance,
          kclManager,
          rustContext,
          engineCommandManager,
          commandBarActor,
          machineManager,
        } = await buildTheWorldAndNoEngineConnection()
        kclManager.sceneInfra.renderer.clear = vi.fn()
        toastErrorSpy.mockClear()
        const context = generateModelingMachineDefaultContext({
          kclManager,
          rustContext,
          wasmInstance: instance,
          engineCommandManager,
          commandBarActor,
          machineManager,
        })
        const settings = kclManager.systemDeps.settings.getSnapshot().context
        settings.modeling.cameraProjection.user = projection
        context.store.defaultUnit = settings.modeling.defaultUnit
        context.store.cameraProjection = settings.modeling.cameraProjection
        kclManager.sceneInfra.camControls.camera.position.set(0, -10, 10)
        const plane: DefaultPlane = {
          type: 'defaultPlane',
          plane: 'XY',
          planeId: 'test-plane-id',
          zAxis: [0, 0, 1],
          yAxis: [0, 1, 0],
        }
        const machine = modelingMachine.provide({
          actors: {
            'animate-to-sketch-solve': fromPromise(
              async (): Promise<{
                plane: DefaultPlane | ExtrudeFacePlane | OffsetPlane
                sketchSolveId: number
                initialSceneGraphDelta: SceneGraphDelta
              }> => ({
                plane,
                sketchSolveId: 1,
                initialSceneGraphDelta: dummyInitSketchGraphDelta,
              })
            ),
          },
        })
        const actor = createActor(machine, { input: context }).start()
        try {
          actor.send({ type: 'Enter sketch' })
          actor.send({
            type: 'Select sketch solve plane',
            data: 'test-plane-id',
          })
          await waitFor(actor, (snapshot) =>
            snapshot.matches({ sketchSolveMode: 'active' })
          )
          toastErrorSpy.mockClear()
          actor.send({ type: 'Exit sketch' })
          await waitFor(
            actor,
            (snapshot) =>
              snapshot.matches('idle') ||
              toastErrorSpy.mock.calls.some(
                ([message]) =>
                  message ===
                  'Camera command sketch_mode_disable was not acknowledged'
              )
          )
          expect(actor.getSnapshot().matches('idle')).toBe(true)
          expect(kclManager.sceneInfra.camControls.enableRotate).toBe(true)
          expect(kclManager.sceneInfra.camControls.enablePan).toBe(true)
          expect(kclManager.sceneInfra.camControls.syncDirection).toBe(
            'engineToClient'
          )
          expect(toastErrorSpy).toHaveBeenCalledWith(
            'Camera command sketch_mode_disable was not acknowledged'
          )
          expect(actor.getSnapshot().context.sketchDetails).toBeNull()
        } finally {
          actor.stop()
          kclManager.close()
        }
      }
    )

    it('disables camera orbit controls in sketch solve mode', async () => {
      const {
        instance,
        kclManager,
        rustContext,
        engineCommandManager,
        commandBarActor,
        machineManager,
      } = await buildTheWorldAndNoEngineConnection()

      const context = generateModelingMachineDefaultContext({
        kclManager,
        rustContext,
        wasmInstance: instance,
        engineCommandManager,
        commandBarActor,
        machineManager,
      })
      context.store.defaultUnit = { current: 'mm' } as any
      context.projectRef = { current: {} as any }

      const machine = modelingMachine.provide({
        actors: {
          'animate-to-sketch-solve': fromPromise(async () => ({
            plane: {
              type: 'defaultPlane',
              plane: 'XY',
              planeId: 'test-plane-id',
              zAxis: [0, 0, 1],
              yAxis: [0, 1, 0],
              origin: [0, 0, 0],
            } as any,
            sketchSolveId: 1,
            initialSceneGraphDelta: dummyInitSketchGraphDelta,
          })),
        },
      })

      const actor = createActor(machine, { input: context }).start()

      actor.send({ type: 'Enter sketch' })
      actor.send({
        type: 'Select sketch solve plane',
        data: 'test-plane-id',
      })

      await waitForCondition(() => {
        return (
          JSON.stringify(actor.getSnapshot().value) ===
          JSON.stringify({
            sketchSolveMode: 'active',
          })
        )
      })

      expect(kclManager.sceneInfra.camControls.enableRotate).toBe(false)
      expect(kclManager.sceneInfra.camControls.syncDirection).toBe(
        'clientToEngine'
      )
    })
  })
})

describe('positionLocalSketchSolveCamera', () => {
  it('orients the sketch before aiming the camera at it', async () => {
    const order: string[] = []
    const sketchSolveGroup = {}
    const plane: DefaultPlane = {
      type: 'defaultPlane',
      plane: 'XZ',
      planeId: 'plane-id',
      zAxis: [0, -1, 0],
      yAxis: [0, 0, 1],
    }
    const initSketchSolveEntityOrientation = vi.fn(() => {
      order.push('orient sketch')
    })
    const transitionToSketch = vi.fn(async () => {
      order.push('aim camera')
    })
    const signal = new AbortController().signal

    await positionLocalSketchSolveCamera(
      {
        sceneEntitiesManager: {
          sketchSolveGroup,
          initSketchSolveEntityOrientation,
        },
        sceneInfra: { camControls: { transitionToSketch } },
      } as unknown as KclManager,
      plane,
      signal
    )

    expect(order).toEqual(['orient sketch', 'aim camera'])
    expect(initSketchSolveEntityOrientation).toHaveBeenCalledWith(plane)
    expect(transitionToSketch).toHaveBeenCalledWith(sketchSolveGroup, signal)
  })
})
