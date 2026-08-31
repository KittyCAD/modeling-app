import type { Artifact } from '@rust/kcl-lib/bindings/Artifact'
import { computed, signal } from '@preact/signals'
import { describe, expect, it, vi } from 'vitest'
import type { DefaultPlanesService } from '@src/contracts/defaultPlanes'
import type { ExecutedProgram, KclSceneService } from '@src/contracts/kclScene'
import type { ScenePoint } from '@src/contracts/scene'
import type {
  PickedRegion,
  ScenePicker,
  SweptFace,
} from '@src/contracts/selection'
import { createSelectionService } from '@src/features/selection/createSelectionService'
import { artifactsFrom, sourceRangeFor } from '@src/lib/kcl/artifacts'

const at: ScenePoint = { x: 10, y: 10, viewport: { width: 100, height: 100 } }

const codeRef = (start: number, end: number) => ({
  range: [start, end, 0] as [number, number, number],
  nodePath: {} as never,
  pathToNode: [],
})

/** A graph with one segment and one wall that has to be walked to reach it. */
const artifacts = artifactsFrom({
  map: {
    seg: { type: 'segment', id: 'seg', pathId: 'p', codeRef: codeRef(40, 70) },
    wall: {
      type: 'wall',
      id: 'wall',
      segId: 'seg',
      sweepId: 'sweep',
      edgeCutEdgeIds: [],
      pathIds: [],
    },
  },
})

function setup(
  options: {
    picks?: (string | null)[]
    ready?: boolean
    scene?: boolean
    fail?: boolean
    region?: PickedRegion | null
    faces?: readonly SweptFace[]
    planes?: boolean
  } = {}
) {
  const queue = [...(options.picks ?? ['wall'])]
  const asked: ScenePoint[] = []
  const described: string[] = []
  const askedForFaces: string[] = []

  const picker: ScenePicker = {
    id: 'fake',
    ready: computed(() => options.ready ?? true),
    pick: async (point) => {
      asked.push(point)
      if (options.fail) throw new Error('the engine went away')
      return queue.shift() ?? null
    },
    hover: async () => null,
    highlight: () => {},
    describeRegion: async (entityId) => {
      described.push(entityId)
      return options.region ?? null
    },
    sweptFaces: async (solidId) => {
      askedForFaces.push(solidId)
      return options.faces ?? []
    },
    faceUuid: async () => null,
  }

  const scene: KclSceneService = {
    artifacts: computed(() => artifacts),
    artifactFor: (id) => artifacts.get(id),
    sourceRangeFor: (id) => sourceRangeFor(artifacts, id),
    // Selection reads the graph, not the program.
    program: computed(() => null),
    operations: computed(() => ({ map: {} })),
    defaultPlanes: computed(() => null),
  }

  /*
   * A renderer that knows one of its objects is the XY plane, which is the only
   * way anything can know that: a default plane is in no file and no artifact.
   */
  const planes = {
    planeAt: (entityId: string) =>
      entityId === 'plane-xy'
        ? ({ plane: 'xy', facing: 'front' } as const)
        : null,
  } as unknown as DefaultPlanesService

  const selection = createSelectionService({
    picker: () => picker,
    scene: () => (options.scene === false ? undefined : scene),
    planes: () => (options.planes === false ? undefined : planes),
  })

  return { selection, asked, described, askedForFaces }
}

describe('selecting by clicking', () => {
  it('names what was picked, walking the graph for the source', async () => {
    const { selection } = setup({ picks: ['wall'] })

    await selection.selectAt(at)

    expect(selection.entities.value).toEqual([
      // The wall carries no code of its own, so the answer is the segment that
      // drew it.
      {
        entityId: 'wall',
        kind: 'wall',
        sourceRange: [40, 70, 0],
        defaultPlane: null,
        region: null,
        originCurve: null,
        faceIndex: null,
      },
    ])
  })

  /**
   * A click on geometry the graph cannot name is still a selection: the engine is
   * highlighting it and the user can see what they picked.
   */
  it('selects what it cannot name', async () => {
    const { selection } = setup({ picks: ['mystery'] })

    await selection.selectAt(at)

    expect(selection.entities.value).toEqual([
      {
        entityId: 'mystery',
        kind: null,
        sourceRange: null,
        defaultPlane: null,
        region: null,
        originCurve: null,
        faceIndex: null,
      },
    ])
  })

  /*
   * The case that used to dead-end. A default plane is real and clickable and in
   * nobody's file, so without the renderer naming it the selection is a uuid
   * nothing downstream can turn into KCL.
   */
  it('names a default plane, which no graph could', async () => {
    const { selection } = setup({ picks: ['plane-xy'] })

    await selection.selectAt(at)

    expect(selection.entities.value[0]).toMatchObject({
      entityId: 'plane-xy',
      kind: null,
      sourceRange: null,
      defaultPlane: { plane: 'xy', facing: 'front' },
    })
  })

  /* Named already, so there is nothing a round trip could add. */
  it('does not ask whether a plane is a region', async () => {
    const { selection, described } = setup({ picks: ['plane-xy'] })

    await selection.selectAt(at)

    expect(described).toEqual([])
  })

  it('works with no artifact graph at all', async () => {
    const { selection } = setup({ picks: ['wall'], scene: false })

    await selection.selectAt(at)

    expect(selection.entities.value).toEqual([
      {
        entityId: 'wall',
        kind: null,
        sourceRange: null,
        defaultPlane: null,
        region: null,
        originCurve: null,
        faceIndex: null,
      },
    ])
  })

  it('replaces by default', async () => {
    const { selection } = setup({ picks: ['wall', 'seg'] })

    await selection.selectAt(at)
    await selection.selectAt(at)

    expect(selection.entities.value.map((e) => e.entityId)).toEqual(['seg'])
  })

  it('adds and removes when asked', async () => {
    const { selection } = setup({ picks: ['wall', 'seg', 'wall'] })

    await selection.selectAt(at)
    await selection.selectAt(at, 'add')
    expect(selection.entities.value.map((e) => e.entityId)).toEqual([
      'wall',
      'seg',
    ])

    await selection.selectAt(at, 'remove')
    expect(selection.entities.value.map((e) => e.entityId)).toEqual(['seg'])
  })

  it('does not add the same entity twice', async () => {
    const { selection } = setup({ picks: ['wall', 'wall'] })

    await selection.selectAt(at)
    await selection.selectAt(at, 'add')

    expect(selection.entities.value).toHaveLength(1)
  })

  it('clears when a plain click lands on nothing', async () => {
    const { selection } = setup({ picks: ['wall', null] })

    await selection.selectAt(at)
    await selection.selectAt(at)

    expect(selection.entities.value).toEqual([])
  })

  /**
   * Losing a five-part selection to a slightly wide shift-click is the kind of
   * thing people stop trusting.
   */
  it('keeps the selection when a shift-click misses', async () => {
    const { selection } = setup({ picks: ['wall', null] })

    await selection.selectAt(at)
    await selection.selectAt(at, 'add')

    expect(selection.entities.value.map((e) => e.entityId)).toEqual(['wall'])
  })

  it('asks nothing while there is nothing rendering', async () => {
    const { selection, asked } = setup({ ready: false })

    await selection.selectAt(at)

    expect(asked).toEqual([])
    expect(selection.entities.value).toEqual([])
  })

  it('leaves the selection alone when the pick fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { selection } = setup({ picks: ['wall'] })
    await selection.selectAt(at)

    const failing = setup({ fail: true })
    await failing.selection.selectAt(at)

    expect(selection.entities.value).toHaveLength(1)
    expect(failing.selection.entities.value).toEqual([])
    expect(failing.selection.picking.value).toBe(false)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('says while it is asking, and stops when it has an answer', async () => {
    const { selection } = setup()

    const inFlight = selection.selectAt(at)
    expect(selection.picking.value).toBe(true)

    await inFlight
    expect(selection.picking.value).toBe(false)
  })

  it('can be told directly, without a click', () => {
    const { selection } = setup()

    selection.select(['seg'])
    expect(selection.entities.value).toEqual([
      {
        entityId: 'seg',
        kind: 'segment',
        sourceRange: [40, 70, 0],
        defaultPlane: null,
        region: null,
        originCurve: null,
        faceIndex: null,
      },
    ])

    selection.clear()
    expect(selection.entities.value).toEqual([])
  })
})

/*
 * A click on nothing is a statement — "nothing, thanks" — and the caller acts on
 * it, so it has to be distinguishable from a pick that simply did not happen.
 */
describe('what a click reports back', () => {
  it('answers with the entity it selected', async () => {
    const { selection } = setup({ picks: ['wall'] })

    expect(await selection.selectAt(at)).toBe('wall')
  })

  it('answers null for a click on nothing', async () => {
    const { selection } = setup({ picks: [null] })

    expect(await selection.selectAt(at)).toBeNull()
  })

  it('answers null when there is nothing to pick with', async () => {
    const { selection } = setup({ ready: false })

    expect(await selection.selectAt(at)).toBeNull()
  })

  it('answers null when the pick fails', async () => {
    const { selection } = setup({ fail: true })

    expect(await selection.selectAt(at)).toBeNull()
  })

  it('still answers with the entity when removing it', async () => {
    const { selection } = setup({ picks: ['wall'] })

    expect(await selection.selectAt(at, 'remove')).toBe('wall')
  })
})

/*
 * The engine can be asked which curve made a face. It is the same command
 * kcl-lib builds wall artifacts from, so it usually restates what the graph
 * already holds — which is exactly why it is asked only when the graph's answer
 * is unusable, and why a different answer is worth keeping.
 */
describe('asking the engine which curve made a face', () => {
  const named = (start: number, end: number) => ({
    range: [start, end, 0] as [number, number, number],
    nodePath: {} as never,
    pathToNode: [],
  })

  /** A wall whose segment is the `region(…)` call: nothing in the file names it. */
  const regionGraph = artifactsFrom({
    map: {
      regionSeg: {
        type: 'segment',
        id: 'regionSeg',
        pathId: 'regionPath',
        codeRef: named(309, 367),
      },
      sketchSeg: {
        type: 'segment',
        id: 'sketchSeg',
        pathId: 'sketchPath',
        codeRef: named(65, 99),
      },
      sweep: {
        type: 'sweep',
        id: 'sweep',
        subType: 'extrusion',
        pathId: 'regionPath',
        surfaceIds: [],
        edgeIds: [],
        codeRef: named(382, 413),
      },
      wall: {
        type: 'wall',
        id: 'wall',
        segId: 'regionSeg',
        sweepId: 'sweep',
        edgeCutEdgeIds: [],
        pathIds: [],
        faceCodeRef: named(0, 0),
        cmdId: 'c1',
      },
    },
  })

  const node = { start: 0, end: 0, moduleId: 0, commentStart: 0 }

  const name = (value: string) => ({
    ...node,
    type: 'Name',
    abs_path: false,
    path: [],
    name: { ...node, type: 'Identifier', name: value },
  })

  const declare = (bound: string, init: unknown, span: [number, number]) => ({
    ...node,
    type: 'VariableDeclaration',
    start: span[0],
    end: span[1],
    kind: 'const',
    declaration: {
      ...node,
      type: 'VariableDeclarator',
      id: { ...node, type: 'Identifier', name: bound },
      init,
    },
  })

  /** `s = sketch(…) { l1 = line(…) }`, a region, and the extrude of it. */
  const executed = {
    source: 'x'.repeat(420),
    ast: {
      body: [
        {
          ...declare('s', null, [41, 308]),
          declaration: {
            ...node,
            type: 'VariableDeclarator',
            id: { ...node, type: 'Identifier', name: 's' },
            init: {
              ...node,
              type: 'SketchBlock',
              arguments: [],
              body: {
                ...node,
                type: 'Block',
                items: [
                  declare(
                    'l1',
                    {
                      ...node,
                      type: 'CallExpressionKw',
                      unlabeled: null,
                      arguments: [],
                      callee: name('line'),
                    },
                    [65, 99]
                  ),
                ],
              },
            },
          },
        },
        declare(
          'region001',
          {
            ...node,
            type: 'CallExpressionKw',
            unlabeled: null,
            arguments: [],
            callee: name('region'),
          },
          [309, 368]
        ),
        declare(
          'extrude001',
          {
            ...node,
            type: 'CallExpressionKw',
            unlabeled: name('region001'),
            arguments: [],
            callee: name('extrude'),
          },
          [369, 413]
        ),
      ],
    },
  } as unknown as ExecutedProgram

  const withProgram = (
    options: {
      faces?: readonly SweptFace[]
      artifacts?: ReturnType<typeof artifactsFrom>
      program?: ExecutedProgram | null
      /** What the engine says the nth face's uuid is. */
      uuidByIndex?: (index: number) => string | null
    } = {}
  ) => {
    const map = options.artifacts ?? regionGraph
    const askedForFaces: string[] = []

    const picker: ScenePicker = {
      id: 'fake',
      ready: computed(() => true),
      pick: async () => 'wall',
      hover: async () => null,
      highlight: () => {},
      describeRegion: async () => null,
      sweptFaces: async (solidId) => {
        askedForFaces.push(solidId)
        return options.faces ?? []
      },
      faceUuid: async (_solidId, index) => options.uuidByIndex?.(index) ?? null,
    }

    const scene: KclSceneService = {
      artifacts: computed(() => map),
      artifactFor: (id) => map.get(id),
      sourceRangeFor: (id) => sourceRangeFor(map, id),
      program: computed(() =>
        options.program === undefined ? executed : options.program
      ),
      operations: computed(() => ({ map: {} })),
      defaultPlanes: computed(() => null),
    }

    const selection = createSelectionService({
      picker: () => picker,
      scene: () => scene,
      planes: () => undefined,
    })

    return { selection, askedForFaces }
  }

  it('asks about the path the segment belongs to', async () => {
    const app = withProgram()

    await app.selection.selectAt(at)

    expect(app.askedForFaces).toEqual(['regionPath'])
  })

  it('keeps a curve the engine names differently', async () => {
    const app = withProgram({
      faces: [{ face: 'wall', curve: 'sketchSeg', cap: 'none' }],
    })

    await app.selection.selectAt(at)

    expect(app.selection.entities.value[0].originCurve).toBe('sketchSeg')
  })

  /*
   * The expected case: kcl-lib set the wall's segment from this curve, so the
   * engine has nothing the graph did not already have.
   */
  it('keeps nothing when the engine agrees with the graph', async () => {
    const app = withProgram({
      faces: [{ face: 'wall', curve: 'regionSeg', cap: 'none' }],
    })

    await app.selection.selectAt(at)

    expect(app.selection.entities.value[0].originCurve).toBeNull()
  })

  it('does not ask before anything has been executed', async () => {
    const app = withProgram({ program: null })

    await app.selection.selectAt(at)

    expect(app.askedForFaces).toEqual([])
  })

  it('does not ask about a face the file can already name', async () => {
    const nameable = artifactsFrom({
      map: {
        sketchSeg: {
          type: 'segment',
          id: 'sketchSeg',
          pathId: 'sketchPath',
          codeRef: named(65, 99),
        },
        sweep: {
          type: 'sweep',
          id: 'sweep',
          subType: 'extrusion',
          pathId: 'sketchPath',
          surfaceIds: [],
          edgeIds: [],
          codeRef: named(382, 413),
        },
        wall: {
          type: 'wall',
          id: 'wall',
          segId: 'sketchSeg',
          sweepId: 'sweep',
          edgeCutEdgeIds: [],
          pathIds: [],
          faceCodeRef: named(0, 0),
          cmdId: 'c1',
        },
      },
    })

    const app = withProgram({ artifacts: nameable })

    await app.selection.selectAt(at)

    expect(app.askedForFaces).toEqual([])
  })

  it('survives an engine that will not answer', async () => {
    const map = regionGraph
    const picker: ScenePicker = {
      id: 'fake',
      ready: computed(() => true),
      pick: async () => 'wall',
      hover: async () => null,
      highlight: () => {},
      describeRegion: async () => null,
      sweptFaces: async () => {
        throw new Error('the engine went away')
      },
      faceUuid: async () => null,
    }

    const selection = createSelectionService({
      picker: () => picker,
      planes: () => undefined,
      scene: () => ({
        artifacts: computed(() => map),
        artifactFor: (id: string) => map.get(id),
        sourceRangeFor: (id: string) => sourceRangeFor(map, id),
        program: computed(() => executed),
        operations: computed(() => ({ map: {} })),
        defaultPlanes: computed(() => null),
      }),
    })

    await selection.selectAt(at)

    expect(selection.entities.value[0].entityId).toBe('wall')
    expect(selection.entities.value[0].originCurve).toBeNull()
  })
})

/*
 * The engine's face index is what lets somebody sketch on a side face the file
 * cannot name. It is confirmed against the engine first, because an assumed
 * ordering fails silently on somebody else's model.
 */
describe('finding the engine face index', () => {
  const named = (start: number, end: number) => ({
    range: [start, end, 0] as [number, number, number],
    nodePath: {} as never,
    pathToNode: [],
  })

  const wallFaces: readonly SweptFace[] = [
    { face: 'other', curve: 'c0', cap: 'none' },
    { face: 'wall', curve: 'regionSeg', cap: 'none' },
    { face: 'top', curve: null, cap: 'top' },
  ]

  const setupIndex = (uuidByIndex: (index: number) => string | null) => {
    const map = artifactsFrom({
      map: {
        regionSeg: {
          type: 'segment',
          id: 'regionSeg',
          pathId: 'regionPath',
          codeRef: named(309, 367),
        },
        sweep: {
          type: 'sweep',
          id: 'sweep',
          subType: 'extrusion',
          pathId: 'regionPath',
          surfaceIds: [],
          edgeIds: [],
          codeRef: named(382, 413),
        },
        wall: {
          type: 'wall',
          id: 'wall',
          segId: 'regionSeg',
          sweepId: 'sweep',
          edgeCutEdgeIds: [],
          pathIds: [],
          faceCodeRef: named(0, 0),
          cmdId: 'c1',
        },
      },
    })

    const askedIndices: number[] = []
    const executed = {
      source: 'x'.repeat(420),
      ast: {
        body: [
          {
            type: 'VariableDeclaration',
            start: 369,
            end: 413,
            declaration: {
              type: 'VariableDeclarator',
              id: { type: 'Identifier', name: 'extrude001' },
              init: {
                type: 'CallExpressionKw',
                unlabeled: null,
                arguments: [],
                callee: {
                  type: 'Name',
                  path: [],
                  name: { type: 'Identifier', name: 'extrude' },
                },
              },
            },
          },
        ],
      },
    } as unknown as ExecutedProgram

    const picker: ScenePicker = {
      id: 'fake',
      ready: computed(() => true),
      pick: async () => 'wall',
      hover: async () => null,
      highlight: () => {},
      describeRegion: async () => null,
      sweptFaces: async () => wallFaces,
      faceUuid: async (_solidId, index) => {
        askedIndices.push(index)
        return uuidByIndex(index)
      },
    }

    const selection = createSelectionService({
      picker: () => picker,
      planes: () => undefined,
      scene: () => ({
        artifacts: computed(() => map),
        artifactFor: (id: string) => map.get(id),
        sourceRangeFor: (id: string) => sourceRangeFor(map, id),
        program: computed(() => executed),
        operations: computed(() => ({ map: {} })),
        defaultPlanes: computed(() => null),
      }),
    })

    return { selection, askedIndices }
  }

  /* One round trip when the list order is the index order, which it usually is. */
  it('confirms the position in the face list and stops there', async () => {
    const app = setupIndex((index) => (index === 1 ? 'wall' : 'other'))

    await app.selection.selectAt(at)

    expect(app.selection.entities.value[0].faceIndex).toBe(1)
    expect(app.askedIndices).toEqual([1])
  })

  it('asks about the rest when the guess is wrong', async () => {
    const app = setupIndex((index) => (index === 2 ? 'wall' : 'nope'))

    await app.selection.selectAt(at)

    expect(app.selection.entities.value[0].faceIndex).toBe(2)
    // The guess, then the others together.
    expect(app.askedIndices).toContain(0)
    expect(app.askedIndices).toContain(2)
  })

  it('keeps no index when the engine never names the face', async () => {
    const app = setupIndex(() => 'somebody-else')

    await app.selection.selectAt(at)

    expect(app.selection.entities.value[0].faceIndex).toBeNull()
  })

  it('still selects the face when the engine will not answer', async () => {
    const app = setupIndex(() => null)

    await app.selection.selectAt(at)

    expect(app.selection.entities.value[0].entityId).toBe('wall')
    expect(app.selection.entities.value[0].faceIndex).toBeNull()
  })
})
