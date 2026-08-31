import type { SceneGraph } from '@rust/kcl-lib/bindings/FrontendApi'
import type { NumericSuffix } from '@rust/kcl-lib/bindings/NumericSuffix'
import { signal } from '@preact/signals'
import { describe, expect, it, vi } from 'vitest'
import { combineCapabilities } from '@src/contracts/buffers'
import { requestExecution } from '@src/lib/buffers/annotations'
import type {
  KclFrontendService,
  SetProgramResult,
} from '@src/contracts/kclFrontend'
import type { CameraDriver } from '@src/contracts/scene'
import type { SceneProjection } from '@src/contracts/sceneProjection'
import type { Artifact } from '@rust/kcl-lib/bindings/Artifact'
import type { ArtifactMap } from '@src/lib/kcl/artifacts'
import { createSketchSession } from '@src/features/sketchMode/createSketchSession'
import { createFileBackedTextBuffer } from '@src/lib/buffers/createFileBackedTextBuffer'
import type { SketchBlockRange } from '@src/lib/kclStdlib/program'

const SOURCE = 's = sketch(on = XY) {\n}\n'

/**
 * A graph whose one sketch is written where the fixture's sketch is.
 *
 * `range` is the frontend's own idea of the sketch's extent, which is *not* ours:
 * it covers the `sketch(…)` expression, so it begins after the `s = ` that our
 * own block range starts at.
 */
const graph = (range: [number, number, number] = [0, 23, 0]): SceneGraph =>
  ({
    objects: [
      {
        id: 0,
        kind: {
          type: 'Sketch',
          args: { on: { default: 'XY' } },
          plane: 9,
          segments: [],
          constraints: [],
        },
        label: 's',
        comments: '',
        artifact_id: 'a',
        source: { type: 'Simple', range, node_path: null },
      },
    ],
    sketch_mode: null,
  }) as unknown as SceneGraph

/** The XY plane, as a run that succeeded reports it. */
const onXY: ArtifactMap = new Map<string, Artifact>([
  [
    'block',
    {
      type: 'sketchBlock',
      id: 'block',
      sketchId: 0,
      codeRef: { range: [0, 23, 0] },
      planeInfo: {
        origin: { x: 0, y: 0, z: 0, units: 'mm' },
        xAxis: { x: 1, y: 0, z: 0, units: null },
        yAxis: { x: 0, y: 1, z: 0, units: null },
        zAxis: { x: 0, y: 0, z: 1, units: null },
      },
    } as unknown as Artifact,
  ],
])

/**
 * What a segment-creating call answers with.
 *
 * Two points and a line, and the line's `end` is what the tool takes hold of —
 * which is why the ids matter here rather than being arbitrary.
 */
const drawnOutcome = () => ({
  text: SOURCE,
  newObjects: [0, 1, 2],
  invalidatesIds: false,
  checkpointId: null,
  // A solve that worked. Mutations report a refusal here rather than rejecting.
  problem: null,
  graph: {
    objects: [
      {
        id: 0,
        kind: {
          type: 'Segment',
          segment: {
            type: 'Point',
            position: {
              x: { value: 0, units: 'Mm' },
              y: { value: 0, units: 'Mm' },
            },
            freedom: 'Free',
            constraints: [],
            ctor: null,
            owner: null,
          },
        },
      },
      {
        id: 1,
        kind: {
          type: 'Segment',
          segment: {
            type: 'Point',
            position: {
              x: { value: 0, units: 'Mm' },
              y: { value: 0, units: 'Mm' },
            },
            freedom: 'Free',
            constraints: [],
            ctor: null,
            owner: null,
          },
        },
      },
      {
        id: 2,
        kind: {
          type: 'Segment',
          segment: {
            type: 'Line',
            start: 0,
            end: 1,
            ctor: { type: 'Line' },
            ctor_applicable: true,
            construction: false,
          },
        },
      },
      // A second line, so a constraint tool can be given two of something.
      {
        id: 3,
        kind: {
          type: 'Segment',
          segment: {
            type: 'Point',
            position: {
              x: { value: 5, units: 'Mm' },
              y: { value: 5, units: 'Mm' },
            },
            freedom: 'Free',
            constraints: [],
            ctor: null,
            owner: null,
          },
        },
      },
      {
        id: 4,
        kind: {
          type: 'Segment',
          segment: {
            type: 'Point',
            position: {
              x: { value: 9, units: 'Mm' },
              y: { value: 5, units: 'Mm' },
            },
            freedom: 'Free',
            constraints: [],
            ctor: null,
            owner: null,
          },
        },
      },
      {
        id: 5,
        kind: {
          type: 'Segment',
          segment: {
            type: 'Line',
            start: 3,
            end: 4,
            ctor: { type: 'Line' },
            ctor_applicable: true,
            construction: false,
          },
        },
      },
    ],
    sketch_mode: 0,
  },
})

const setup = (
  options: {
    sketch?: SketchBlockRange | null
    program?: unknown
    setProgram?: () => Promise<SetProgramResult>
    exitThrows?: boolean
    artifacts?: ArtifactMap
    projection?: SceneProjection
    faceOnEntry?: boolean
    /** The project's unit, for a file that declares none. */
    defaultUnit?: NumericSuffix
    addSegment?: (calls: string[]) => Promise<unknown>
    /** Makes a preview solve take long enough for moves to pile up behind it. */
    slowEdit?: boolean
    /** Flips to true to stand in for the executing buffer being closed. */
    bufferGone?: { value: boolean }
    /** Makes every solve report that it could not satisfy the constraints. */
    editProblem?: string
    /** Makes every mutation report that every id has become meaningless. */
    renumbers?: boolean
    /** Makes every constraint report that it could not be satisfied. */
    constraintProblem?: string
  } = {}
) => {
  const buffer = createFileBackedTextBuffer({
    path: '/projects/bracket/main.kcl',
    contents: SOURCE,
    languageId: 'kcl',
    capabilities: combineCapabilities([]),
  })

  const calls: string[] = []
  const camera = {
    faceOn: vi.fn(),
    claimCamera: vi.fn(),
    releaseCamera: vi.fn(),
  } as unknown as CameraDriver
  /*
   * The graph a drag is planned against.
   *
   * Real drags translate whatever the *last solve* produced, so the session
   * reads this rather than remembering positions of its own — which means a
   * frontend double without it cannot drag at all.
   */
  const sceneGraph = signal(drawnOutcome().graph as unknown as SceneGraph)

  const frontend = {
    sceneGraph,
    sync: vi.fn(async () => {
      calls.push('sync')
    }),
    setProgram: vi.fn(
      options.setProgram ??
        (async (): Promise<SetProgramResult> => {
          calls.push('setProgram')
          return { kind: 'built', graph: graph() }
        })
    ),
    editSketch: vi.fn(async () => {
      calls.push('editSketch')
      return {} as never
    }),
    exitSketch: vi.fn(async () => {
      calls.push('exitSketch')
      if (options.exitThrows) throw new Error('the frontend gave up')
      // A bare scene graph: leaving a sketch changes no text.
      return graph()
    }),
    addSegment: vi.fn(async () => {
      calls.push('addSegment')
      const outcome = await (options.addSegment?.(calls) ??
        Promise.resolve(drawnOutcome()))
      return {
        ...(outcome as object),
        ...(options.renumbers ? { invalidatesIds: true } : {}),
      } as never
    }),
    editConstraintValue: vi.fn(async () => {
      calls.push('editConstraintValue')
      return drawnOutcome() as never
    }),
    addConstraint: vi.fn(async () => {
      calls.push('addConstraint')
      return {
        ...drawnOutcome(),
        problem: options.constraintProblem ?? null,
      } as never
    }),
    editSegments: vi.fn(async () => {
      calls.push('editSegments')
      if (options.slowEdit) {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      return {
        ...drawnOutcome(),
        problem: options.editProblem ?? null,
      } as never
    }),
    chainSegment: vi.fn(async () => {
      calls.push('chainSegment')
      return drawnOutcome() as never
    }),
    deleteObjects: vi.fn(async () => {
      calls.push('deleteObjects')
      return drawnOutcome() as never
    }),
  } as unknown as KclFrontendService

  const session = createSketchSession({
    frontend: () => frontend,
    sketch: signal(
      options.sketch === undefined
        ? { name: 's', from: 0, to: 23 }
        : options.sketch
    ),
    buffer: () => (options.bufferGone?.value ? null : buffer),
    path: () => 'main.kcl',
    program: () =>
      options.program === undefined ? { body: [] } : options.program,
    artifacts: () => options.artifacts ?? onXY,
    projection: () => options.projection,
    camera: () => camera,
    faceOnEntry: () => options.faceOnEntry ?? true,
    defaultUnit: () => options.defaultUnit ?? 'Mm',
  })

  return { session, buffer, frontend, calls, camera }
}

describe('opening a sketch', () => {
  /*
   * Mirror, then set the program, then open: the middle step is the only one
   * that reaches the engine, and it is what produces the ids a sketch is solved
   * against.
   */
  it('mirrors the buffer, builds a scene, then opens the sketch', async () => {
    const app = setup()

    await app.session.enter()

    expect(app.calls).toEqual(['sync', 'setProgram', 'editSketch'])
    expect(app.session.open.value).toMatchObject({ sketchId: 0, name: 's' })
  })

  it('addresses the sketch the cursor is in', async () => {
    const app = setup()

    await app.session.enter()

    expect(app.frontend.editSketch).toHaveBeenCalledWith(0)
  })

  it('says what to do when the cursor is not in a sketch', async () => {
    const app = setup({ sketch: null })

    await app.session.enter()

    expect(app.session.open.value).toBeNull()
    expect(app.session.error.value).toMatch(/cursor in a sketch/)
  })

  /* A sketch is solved against ids only a real execution produces. */
  it('says the file has to run first', async () => {
    const app = setup({ program: null })

    await app.session.enter()

    expect(app.session.error.value).toMatch(/run the file/)
    expect(app.calls).toEqual([])
  })

  /*
   * kcl-lib does not reject when a program fails — it hands back the partial
   * state — so the reason has to be read out of the answer and repeated. This
   * used to tell somebody to run a file they had just run.
   */
  it('repeats KCL’s own words when the program ran and failed', async () => {
    const app = setup({
      setProgram: async () => ({
        kind: 'failed',
        reason: 'sketch on a face is not supported here',
      }),
    })

    await app.session.enter()

    expect(app.session.error.value).toMatch(/not supported here/)
    expect(app.session.open.value).toBeNull()
  })

  it('says to wait when KCL has not loaded', async () => {
    const app = setup({ setProgram: async () => ({ kind: 'unavailable' }) })

    await app.session.enter()

    expect(app.session.error.value).toMatch(/still loading/)
  })

  it('reports a run whose scene has no sketch there', async () => {
    const app = setup({ sketch: { name: 's', from: 900, to: 950 } })

    await app.session.enter()

    // Names both ranges, because this one is a bug in the crossing between our
    // text ranges and the frontend's ids, and nobody can act on it without them.
    expect(app.session.error.value).toMatch(/900–950/)
    expect(app.session.error.value).toMatch(/#0 at 0–23/)
  })

  it('opens only once', async () => {
    const app = setup()
    await app.session.enter()

    await app.session.enter()

    expect(app.frontend.editSketch).toHaveBeenCalledTimes(1)
  })

  it('knows in advance whether it could open', async () => {
    expect(setup().session.canEnter.value).toBe(true)
    expect(setup({ sketch: null }).session.canEnter.value).toBe(false)
    expect(setup({ program: null }).session.canEnter.value).toBe(false)
  })
})

describe('leaving a sketch', () => {
  /**
   * Whether the buffer was told to run.
   *
   * Leaving returns a scene and no text, because every segment went into the
   * file as it was drawn — so there is no edit to trigger an execution and it
   * has to be asked for out loud.
   */
  const runRequested = (buffer: ReturnType<typeof setup>['buffer']) => {
    let asked = false
    buffer.onChange((change) => {
      if (
        change.transactions.some((transaction) =>
          transaction.annotation(requestExecution)
        )
      ) {
        asked = true
      }
    })
    return () => asked
  }

  it('closes the sketch and asks for the run that renders it', async () => {
    const app = setup()
    await app.session.enter()
    const asked = runRequested(app.buffer)

    await app.session.exit()

    expect(app.session.open.value).toBeNull()
    expect(asked()).toBe(true)
  })

  it('changes no text of its own', async () => {
    const app = setup()
    await app.session.enter()

    await app.session.exit()

    // The only text a session writes is a segment, at the moment it is drawn.
    // Leaving asks for a run, which is a transaction that changes nothing.
    expect(app.buffer.text.value).toBe(SOURCE)
  })

  /*
   * Being unable to close cleanly is bad; being stuck in a session that cannot
   * be left is worse, and the segments are in the file either way.
   */
  it('closes, and still runs, even when the frontend fails', async () => {
    const app = setup({ exitThrows: true })
    await app.session.enter()
    const asked = runRequested(app.buffer)

    await app.session.exit()

    expect(app.session.open.value).toBeNull()
    expect(app.session.error.value).toMatch(/gave up/)
    expect(asked()).toBe(true)
  })

  it('does nothing when no sketch is open', async () => {
    const app = setup()

    await app.session.exit()

    expect(app.frontend.exitSketch).not.toHaveBeenCalled()
  })
})

describe('where the sketch is', () => {
  it('takes the plane from the last run, for free', async () => {
    const app = setup()

    await app.session.enter()

    expect(app.session.open.value?.plane).toEqual({
      origin: { x: 0, y: 0, z: 0 },
      xAxis: { x: 1, y: 0, z: 0, units: null },
      yAxis: { x: 0, y: 1, z: 0, units: null },
      zAxis: { x: 0, y: 0, z: 1, units: null },
    })
  })

  it('asks the renderer where a face is, since only it knows', async () => {
    const frame = {
      origin: { x: 0, y: 0, z: 10 },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 1, z: 0 },
      zAxis: { x: 0, y: 0, z: 1 },
    }
    const frameOf = vi.fn(async () => frame)
    const app = setup({
      artifacts: new Map<string, Artifact>([
        [
          'block',
          {
            type: 'sketchBlock',
            id: 'block',
            sketchId: 0,
            codeRef: { range: [0, 23, 0] },
            planeId: 'plane-of-face',
          } as unknown as Artifact,
        ],
        [
          'plane-of-face',
          {
            type: 'planeOfFace',
            id: 'plane-of-face',
            faceId: 'the-wall',
            codeRef: { range: [0, 0, 0] },
          } as unknown as Artifact,
        ],
      ]),
      projection: { frameOf } as unknown as SceneProjection,
    })

    await app.session.enter()

    expect(frameOf).toHaveBeenCalledWith('the-wall')
    expect(app.session.open.value?.plane).toEqual(frame)
  })

  /*
   * Editing the KCL is worth doing without an overlay, so a sketch nobody can
   * place still opens — and says why it will be blank.
   */
  it('opens anyway when nothing can place the sketch, and says why', async () => {
    const app = setup({ artifacts: new Map() })

    await app.session.enter()

    expect(app.session.open.value?.plane).toBeNull()
    expect(app.session.open.value?.planeProblem).toMatch(/last run/)
  })
})

describe('drawing in a sketch', () => {
  const enterWithLine = async (options: Parameters<typeof setup>[0] = {}) => {
    const app = setup(options)
    await app.session.enter()
    app.session.equip('line')
    return app
  }

  /** Long enough for the action queue to drain, including a slow solve. */
  const settled = () => new Promise((resolve) => setTimeout(resolve, 20))

  /*
   * The idea the whole draft model rests on: the click writes geometry rather
   * than remembering a position, so what gets dragged out is real and solved.
   */
  it('writes a zero-length line on the first click', async () => {
    const app = await enterWithLine()

    app.session.place({ x: 3, y: 4 })
    await vi.waitFor(() =>
      expect(app.frontend.addSegment).toHaveBeenCalledTimes(1)
    )

    expect(app.frontend.addSegment).toHaveBeenCalledWith(
      0,
      {
        type: 'Line',
        // `Var`, not `Number`: a variable the solver may move. A literal is a
        // value it may not touch, and the first constraint would conflict.
        start: {
          x: { type: 'Var', value: 3, units: 'Mm' },
          y: { type: 'Var', value: 4, units: 'Mm' },
        },
        end: {
          x: { type: 'Var', value: 3, units: 'Mm' },
          y: { type: 'Var', value: 4, units: 'Mm' },
        },
      },
      { label: 'line-segment', checkpoint: true }
    )
  })

  it('takes hold of the new line’s end point', async () => {
    const app = await enterWithLine()

    app.session.place({ x: 0, y: 0 })
    await vi.waitFor(() => expect(app.session.draft.value.kind).toBe('drawing'))

    // Point 1 is the end of the line in the fixture's answer.
    expect(app.session.draft.value).toEqual({
      kind: 'drawing',
      pointId: 1,
      segmentIds: [0, 1, 2],
    })
  })

  it('drags that point as a preview on every move', async () => {
    const app = await enterWithLine()
    app.session.place({ x: 0, y: 0 })
    await vi.waitFor(() => expect(app.session.draft.value.kind).toBe('drawing'))

    app.session.moveTo({ x: 9, y: 0 })
    await vi.waitFor(() =>
      expect(app.frontend.editSegments).toHaveBeenCalledTimes(1)
    )

    expect(app.frontend.editSegments).toHaveBeenCalledWith(
      0,
      [
        {
          id: 1,
          ctor: {
            type: 'Point',
            position: {
              x: { type: 'Var', value: 9, units: 'Mm' },
              y: { type: 'Var', value: 0, units: 'Mm' },
            },
          },
        },
      ],
      // A preview: solved and thrown away, so it cannot checkpoint.
      { commit: false, checkpoint: false }
    )
  })

  /*
   * The pointer produces events far faster than a solve comes back, and each
   * one asks for the same thing at a newer position. Replaying the trail the
   * user has already left behind is wasted work on a shared copy of the sketch.
   */
  it('keeps only the newest move while a solve is in flight', async () => {
    const app = await enterWithLine({ slowEdit: true })
    app.session.place({ x: 0, y: 0 })
    await vi.waitFor(() => expect(app.session.draft.value.kind).toBe('drawing'))

    app.session.moveTo({ x: 1, y: 0 })
    app.session.moveTo({ x: 2, y: 0 })
    app.session.moveTo({ x: 3, y: 0 })
    app.session.moveTo({ x: 4, y: 0 })

    await vi.waitFor(() =>
      expect(app.frontend.editSegments).toHaveBeenCalledTimes(2)
    )
    await settled()

    // The first, and then the last — never the two in between.
    expect(app.frontend.editSegments).toHaveBeenCalledTimes(2)
    const [, second] = (
      app.frontend.editSegments as unknown as {
        mock: { calls: unknown[][] }
      }
    ).mock.calls
    expect(JSON.stringify(second)).toContain('"value":4')
  })

  it('commits on the second click and offers to chain', async () => {
    const app = await enterWithLine()
    app.session.place({ x: 0, y: 0 })
    await vi.waitFor(() => expect(app.session.draft.value.kind).toBe('drawing'))

    app.session.place({ x: 10, y: 0 })
    await vi.waitFor(() =>
      expect(app.frontend.editSegments).toHaveBeenCalledTimes(1)
    )

    expect(app.session.draft.value.kind).toBe('chaining')
    expect(app.frontend.editSegments).toHaveBeenCalledWith(
      0,
      expect.anything(),
      { commit: true, checkpoint: true }
    )
  })

  /*
   * Chaining is why the draft model exists at all: a run of lines joined by
   * coincidence constraints is a profile, and a pile of separate lines is not.
   */
  it('chains the next segment from the committed point, on the next move', async () => {
    const app = await enterWithLine()
    app.session.place({ x: 0, y: 0 })
    await vi.waitFor(() => expect(app.session.draft.value.kind).toBe('drawing'))
    app.session.place({ x: 10, y: 0 })
    await vi.waitFor(() =>
      expect(app.session.draft.value.kind).toBe('chaining')
    )

    app.session.moveTo({ x: 10, y: 5 })
    await vi.waitFor(() =>
      expect(app.frontend.chainSegment).toHaveBeenCalledTimes(1)
    )

    expect(app.frontend.chainSegment).toHaveBeenCalledWith(
      0,
      1,
      expect.objectContaining({ type: 'Line' }),
      { label: 'line-segment', checkpoint: true }
    )
  })

  /*
   * The lazy chain step earns its keep here: after a click there is no draft, so
   * stopping needs no deletion.
   */
  it('finishes a chain without deleting anything', async () => {
    const app = await enterWithLine()
    app.session.place({ x: 0, y: 0 })
    await vi.waitFor(() => expect(app.session.draft.value.kind).toBe('drawing'))
    app.session.place({ x: 10, y: 0 })
    await vi.waitFor(() =>
      expect(app.session.draft.value.kind).toBe('chaining')
    )

    app.session.finishChain()
    await settled()

    expect(app.session.draft.value).toEqual({ kind: 'idle' })
    expect(app.frontend.deleteObjects).not.toHaveBeenCalled()
  })

  it('throws a half-drawn line away when it is abandoned', async () => {
    const app = await enterWithLine()
    app.session.place({ x: 0, y: 0 })
    await vi.waitFor(() => expect(app.session.draft.value.kind).toBe('drawing'))

    app.session.cancelTool()
    await vi.waitFor(() =>
      expect(app.frontend.deleteObjects).toHaveBeenCalledTimes(1)
    )

    expect(app.frontend.deleteObjects).toHaveBeenCalledWith(0, {
      segmentIds: [0, 1, 2],
      constraintIds: [],
    })
    expect(app.session.draft.value).toEqual({ kind: 'idle' })
  })

  it('ignores a move with no tool equipped', async () => {
    const app = setup()
    await app.session.enter()

    app.session.moveTo({ x: 1, y: 1 })
    await settled()

    expect(app.frontend.editSegments).not.toHaveBeenCalled()
  })

  it('cannot equip a tool with no sketch open', () => {
    const app = setup()

    app.session.equip('line')

    expect(app.session.tool.value).toBeNull()
  })

  it('puts the tool down on the way out', async () => {
    const app = await enterWithLine()

    await app.session.exit()

    expect(app.session.tool.value).toBeNull()
  })
})

describe('turning to face the plane', () => {
  it('looks straight at the sketch plane on the way in', async () => {
    const app = setup()

    await app.session.enter()

    expect(app.camera.faceOn).toHaveBeenCalledWith({
      origin: { x: 0, y: 0, z: 0 },
      xAxis: { x: 1, y: 0, z: 0, units: null },
      yAxis: { x: 0, y: 1, z: 0, units: null },
      zAxis: { x: 0, y: 0, z: 1, units: null },
    })
  })

  it('leaves the view alone when the preference says to', async () => {
    const app = setup({ faceOnEntry: false })

    await app.session.enter()

    expect(app.camera.faceOn).not.toHaveBeenCalled()
  })

  it('has nothing to look at when the sketch could not be placed', async () => {
    const app = setup({ artifacts: new Map() })

    await app.session.enter()

    // The session still opens — editing the KCL is worth doing without an
    // overlay — but there is no plane to point a camera at.
    expect(app.session.open.value).not.toBeNull()
    expect(app.camera.faceOn).not.toHaveBeenCalled()
  })
})

describe('the other tools', () => {
  /** Long enough for the action queue to drain. */
  const settled = () => new Promise((resolve) => setTimeout(resolve, 20))

  it('writes a point and stays ready for the next one', async () => {
    const app = setup()
    await app.session.enter()
    app.session.equip('point')

    app.session.place({ x: 4, y: 5 })
    await vi.waitFor(() =>
      expect(app.frontend.addSegment).toHaveBeenCalledTimes(1)
    )

    expect(app.frontend.addSegment).toHaveBeenCalledWith(
      0,
      {
        type: 'Point',
        position: {
          x: { type: 'Var', value: 4, units: 'Mm' },
          y: { type: 'Var', value: 5, units: 'Mm' },
        },
      },
      { label: 'point', checkpoint: true }
    )
    // Nothing to drag open, so nothing is held and the tool is ready again.
    expect(app.session.draft.value).toEqual({ kind: 'idle' })
    expect(app.session.tool.value).toBe('point')
  })

  it('writes a circle only once its radius is known', async () => {
    const app = setup()
    await app.session.enter()
    app.session.equip('circle')

    app.session.place({ x: 0, y: 0 })
    await settled()

    // A circle of no radius is degenerate, so the centre click writes nothing.
    expect(app.frontend.addSegment).not.toHaveBeenCalled()
    expect(app.session.draft.value).toEqual({
      kind: 'pending',
      points: [{ x: 0, y: 0 }],
    })

    app.session.place({ x: 10, y: 0 })
    await vi.waitFor(() =>
      expect(app.frontend.addSegment).toHaveBeenCalledTimes(1)
    )

    expect(app.frontend.addSegment).toHaveBeenCalledWith(
      0,
      expect.objectContaining({
        type: 'Circle',
        center: {
          x: { type: 'Var', value: 0, units: 'Mm' },
          y: { type: 'Var', value: 0, units: 'Mm' },
        },
        start: {
          x: { type: 'Var', value: 10, units: 'Mm' },
          y: { type: 'Var', value: 0, units: 'Mm' },
        },
      }),
      { label: 'circle', checkpoint: true }
    )
  })

  it('builds a rectangle as four lines and eight constraints', async () => {
    const app = setup()
    await app.session.enter()
    app.session.equip('cornerRectangle')

    app.session.place({ x: 0, y: 0 })
    await vi.waitFor(() =>
      expect(app.frontend.addConstraint).toHaveBeenCalledTimes(8)
    )

    expect(app.frontend.addSegment).toHaveBeenCalledTimes(4)
    // A rectangle is four lines that are *described* as a rectangle; written
    // any other way the first drag would prove it is not one.
    expect(
      vi
        .mocked(app.frontend.addConstraint)
        .mock.calls.map((call) => call[1].type)
    ).toEqual([
      'Coincident',
      'Coincident',
      'Coincident',
      'Coincident',
      'Parallel',
      'Parallel',
      'Perpendicular',
      'Horizontal',
    ])
    expect(app.session.draft.value).toMatchObject({ kind: 'shaping' })
  })

  it('drags the rectangle out by respecifying all four sides', async () => {
    const app = setup()
    await app.session.enter()
    app.session.equip('cornerRectangle')
    app.session.place({ x: 0, y: 0 })
    await vi.waitFor(() => expect(app.session.draft.value.kind).toBe('shaping'))

    app.session.moveTo({ x: 10, y: 5 })
    await vi.waitFor(() =>
      expect(app.frontend.editSegments).toHaveBeenCalledTimes(1)
    )

    const [, edits] = vi.mocked(app.frontend.editSegments).mock.calls[0] ?? []
    expect(edits).toHaveLength(4)
  })

  it('takes a rectangle away again when it was abandoned while being built', async () => {
    const app = setup()
    await app.session.enter()
    app.session.equip('cornerRectangle')

    app.session.place({ x: 0, y: 0 })
    // Escape, before any of the twelve calls has come back.
    app.session.cancelTool()
    await vi.waitFor(() =>
      expect(app.frontend.deleteObjects).toHaveBeenCalled()
    )

    /*
     * The discard that ran on Escape had nothing to delete — the rectangle did
     * not exist yet — so without this it would be left in the sketch with a
     * state pointing at it.
     */
    expect(app.session.draft.value).toEqual({ kind: 'idle' })
  })

  it('forgets a half-started circle when the tool changes', async () => {
    const app = setup()
    await app.session.enter()
    app.session.equip('circle')
    app.session.place({ x: 0, y: 0 })
    await settled()

    app.session.equip('line')
    await settled()

    expect(app.session.draft.value).toEqual({ kind: 'idle' })
    // Nothing was written, so nothing has to be deleted.
    expect(app.frontend.deleteObjects).not.toHaveBeenCalled()
  })
})

describe('dragging a point', () => {
  /*
   * The bug this covers is the whole reason dragging felt broken: `moveTo`
   * required an equipped tool, a drag equips nothing, and so nothing moved until
   * the release — when the geometry jumped to where the pointer had ended up.
   */
  it('previews every move, with no tool equipped', async () => {
    const app = setup()
    await app.session.enter()

    app.session.beginDrag(1, { x: 0, y: 0 })
    app.session.moveTo({ x: 3, y: 0 })
    await vi.waitFor(() =>
      expect(app.frontend.editSegments).toHaveBeenCalledTimes(1)
    )

    expect(app.session.tool.value).toBeNull()
    expect(app.frontend.editSegments).toHaveBeenCalledWith(
      0,
      [{ id: 1, ctor: expect.objectContaining({ type: 'Point' }) }],
      // A preview: solved and drawn, but not settled and not written to the
      // file, because the next move throws it away.
      expect.objectContaining({ commit: false, checkpoint: false })
    )
  })

  it('commits where the release landed', async () => {
    const app = setup()
    await app.session.enter()

    app.session.beginDrag(1, { x: 0, y: 0 })
    app.session.moveTo({ x: 3, y: 0 })
    app.session.endDrag({ x: 4, y: 0 })
    await vi.waitFor(() =>
      expect(app.frontend.editSegments).toHaveBeenCalledWith(
        0,
        [
          {
            id: 1,
            ctor: {
              type: 'Point',
              position: {
                x: { type: 'Var', value: 4, units: 'Mm' },
                y: { type: 'Var', value: 0, units: 'Mm' },
              },
            },
          },
        ],
        expect.objectContaining({ commit: true, checkpoint: true })
      )
    )

    expect(app.session.draft.value).toEqual({ kind: 'idle' })
  })

  /*
   * The measuring point is where the last *accepted* solve left the pointer.
   * Advancing it on a refusal would leave the pointer and the geometry offset by
   * however far the refused move was, for the rest of the drag.
   */
  it('keeps measuring from the last accepted solve when one is refused', async () => {
    const app = setup({
      editProblem: 'The constraints cannot be satisfied.',
    })
    await app.session.enter()

    app.session.beginDrag(2, { x: 0, y: 0 })
    app.session.moveTo({ x: 3, y: 0 })
    await vi.waitFor(() =>
      expect(app.frontend.editSegments).toHaveBeenCalledTimes(1)
    )

    expect(app.session.draft.value).toEqual({
      kind: 'dragging',
      objectId: 2,
      from: { x: 0, y: 0 },
    })
    expect(app.session.error.value).toBe('The constraints cannot be satisfied.')
  })

  it('advances the measuring point when the solve is accepted', async () => {
    const app = setup()
    await app.session.enter()

    app.session.beginDrag(2, { x: 0, y: 0 })
    app.session.moveTo({ x: 3, y: 0 })
    await vi.waitFor(() =>
      expect(app.frontend.editSegments).toHaveBeenCalledTimes(1)
    )

    expect(app.session.draft.value).toEqual({
      kind: 'dragging',
      objectId: 2,
      from: { x: 3, y: 0 },
    })
  })

  /*
   * Grabbing an edge means "move this line", so every point of it moves by the
   * same vector — and the anchor is what lets a *constrained* edge follow the
   * cursor at all instead of being refused outright.
   */
  it('translates a whole segment when its body is grabbed', async () => {
    const app = setup()
    await app.session.enter()

    app.session.beginDrag(2, { x: 0, y: 0 })
    app.session.moveTo({ x: 5, y: 0 })
    await vi.waitFor(() =>
      expect(app.frontend.editSegments).toHaveBeenCalledTimes(1)
    )

    expect(app.frontend.editSegments).toHaveBeenCalledWith(
      0,
      [{ id: 2, ctor: expect.objectContaining({ type: 'Line' }) }],
      expect.objectContaining({
        anchors: [
          {
            segmentId: 2,
            target: {
              x: { value: 5, units: 'Mm' },
              y: { value: 0, units: 'Mm' },
            },
          },
        ],
      })
    )
  })

  it('still ignores a move when nothing is being moved', async () => {
    const app = setup()
    await app.session.enter()

    app.session.moveTo({ x: 1, y: 1 })
    await new Promise((resolve) => setTimeout(resolve, 20))

    // The draft state is the gate, and idle means there is nothing to move.
    expect(app.frontend.editSegments).not.toHaveBeenCalled()
  })
})

describe('selecting things in a sketch', () => {
  const settled = () => new Promise((resolve) => setTimeout(resolve, 20))

  it('replaces the selection by default and extends it on request', async () => {
    const app = setup()
    await app.session.enter()

    app.session.select(2)
    expect(app.session.selection.value).toEqual([2])

    app.session.select(5)
    expect(app.session.selection.value).toEqual([5])

    app.session.select(2, { add: true })
    expect(app.session.selection.value).toEqual([5, 2])
  })

  /*
   * Order is not decoration: a constraint's meaning depends on it — a midpoint
   * takes a point *and* a line and would be a different request the other way
   * round.
   */
  it('keeps what was picked in the order it was picked', async () => {
    const app = setup()
    await app.session.enter()

    app.session.select(9, { add: true })
    app.session.select(3, { add: true })
    app.session.select('origin', { add: true })

    expect(app.session.selection.value).toEqual([9, 3, 'origin'])
  })

  it('takes something out when it is picked again', async () => {
    const app = setup()
    await app.session.enter()
    app.session.select(2)
    app.session.select(5, { add: true })

    app.session.select(2, { add: true })

    // Which is how a selection is corrected without starting again.
    expect(app.session.selection.value).toEqual([5])
  })

  it('selects nothing with no sketch open', () => {
    const app = setup()

    app.session.select(2)

    expect(app.session.selection.value).toEqual([])
  })

  it('deletes the segments and constraints it is holding', async () => {
    const app = setup()
    await app.session.enter()
    app.session.select(2)

    app.session.deleteSelection()
    await vi.waitFor(() =>
      expect(app.frontend.deleteObjects).toHaveBeenCalledTimes(1)
    )

    expect(app.frontend.deleteObjects).toHaveBeenCalledWith(0, {
      segmentIds: [2],
      constraintIds: [],
    })
    expect(app.session.selection.value).toEqual([])
  })

  it('will not delete the origin, which is not deletable', async () => {
    const app = setup()
    await app.session.enter()
    app.session.select('origin')

    app.session.deleteSelection()
    await settled()

    expect(app.frontend.deleteObjects).not.toHaveBeenCalled()
  })

  /*
   * An id that survives a renumbering names whatever now sits in that slot, so a
   * selection kept across one would silently point at the wrong geometry — and
   * the next constraint would be applied to it.
   */
  it('drops the selection when a solve renumbers the graph', async () => {
    const app = setup({ renumbers: true })
    await app.session.enter()
    app.session.select(2)
    app.session.equip('point')

    app.session.place({ x: 1, y: 1 })
    await vi.waitFor(() => expect(app.session.selection.value).toEqual([]))
  })

  it('forgets the selection on the way out', async () => {
    const app = setup()
    await app.session.enter()
    app.session.select(2)

    await app.session.exit()

    expect(app.session.selection.value).toEqual([])
  })
})

describe('the unit numbers are written in', () => {
  const settled = () => new Promise((resolve) => setTimeout(resolve, 20))

  /*
   * A sketch drawn in a file that works in inches is written in inches. `10mm`
   * would be arithmetically correct and read as though the app had a different
   * idea of the drawing than its author does.
   */
  it('uses the unit the file declares', async () => {
    const app = setup({
      program: {
        body: [],
        innerAttrs: [
          {
            name: { name: 'settings' },
            properties: [
              {
                key: { name: 'defaultLengthUnit' },
                value: { type: 'Name', name: { name: 'in' } },
              },
            ],
          },
        ],
      },
      defaultUnit: 'Mm',
    })
    await app.session.enter()
    app.session.equip('point')

    app.session.place({ x: 2, y: 3 })
    await vi.waitFor(() =>
      expect(app.frontend.addSegment).toHaveBeenCalledTimes(1)
    )

    expect(app.frontend.addSegment).toHaveBeenCalledWith(
      0,
      {
        type: 'Point',
        position: {
          x: { type: 'Var', value: 2, units: 'Inch' },
          y: { type: 'Var', value: 3, units: 'Inch' },
        },
      },
      expect.anything()
    )
  })

  /*
   * The project's, not millimetres: the same value is threaded into the executor
   * as `base_unit`, so the file's unsuffixed numbers already mean this — and
   * writing anything else would make the sketch disagree with the geometry it
   * was drawn on.
   */
  it('falls back to the project’s unit when the file declares none', async () => {
    const app = setup({ defaultUnit: 'Cm' })
    await app.session.enter()
    app.session.equip('point')

    app.session.place({ x: 2, y: 3 })
    await vi.waitFor(() =>
      expect(app.frontend.addSegment).toHaveBeenCalledTimes(1)
    )

    expect(app.frontend.addSegment).toHaveBeenCalledWith(
      0,
      expect.objectContaining({
        position: {
          x: { type: 'Var', value: 2, units: 'Cm' },
          y: { type: 'Var', value: 3, units: 'Cm' },
        },
      }),
      expect.anything()
    )
  })
})

describe('constraining a selection', () => {
  const settled = () => new Promise((resolve) => setTimeout(resolve, 20))

  it('writes the constraint the selection asked for', async () => {
    const app = setup()
    await app.session.enter()
    // Two points, which is a coincidence.
    app.session.select(0)
    app.session.select(1, { add: true })

    app.session.applyConstraint('coincident')
    await vi.waitFor(() =>
      expect(app.frontend.addConstraint).toHaveBeenCalledTimes(1)
    )

    expect(app.frontend.addConstraint).toHaveBeenCalledWith(
      0,
      { type: 'Coincident', segments: [0, 1] },
      { checkpoint: true }
    )
  })

  /*
   * Refused rather than attempted, and with the one message a user can act on:
   * what is selected is not something this constraint applies to.
   */
  it('says so when the selection cannot take that constraint', async () => {
    const app = setup()
    await app.session.enter()
    app.session.select(0)

    app.session.applyConstraint('perpendicular')
    await settled()

    expect(app.frontend.addConstraint).not.toHaveBeenCalled()
    expect(app.session.error.value).toMatch(/perpendicular/)
  })

  it('stops at the first constraint the solver refuses', async () => {
    const app = setup({ constraintProblem: 'Those cannot both be true.' })
    await app.session.enter()
    // Two lines: one horizontal each, so two constraints from one press.
    app.session.select(2)
    app.session.select(5, { add: true })

    app.session.applyConstraint('horizontal')
    await vi.waitFor(() =>
      expect(app.session.error.value).toBe('Those cannot both be true.')
    )

    /*
     * kcl-lib reports a constraint it cannot satisfy in the outcome rather than
     * by rejecting, so without stopping we would pile more onto a sketch that
     * already cannot be solved.
     */
    expect(app.frontend.addConstraint).toHaveBeenCalledTimes(1)
  })
})

describe('dimensioning a selection', () => {
  const settled = () => new Promise((resolve) => setTimeout(resolve, 20))

  it('measures the selection and writes the constraint', async () => {
    const app = setup()
    await app.session.enter()
    // Points 0 at the origin and 1 at (0,0) in the fixture are coincident, so
    // dimension the two ends of the second line instead: (5,5) to (9,5).
    app.session.select(3)
    app.session.select(4, { add: true })

    app.session.applyDimension()
    await vi.waitFor(() =>
      expect(app.frontend.addConstraint).toHaveBeenCalledTimes(1)
    )

    expect(app.frontend.addConstraint).toHaveBeenCalledWith(
      0,
      expect.objectContaining({
        type: 'Distance',
        segments: [3, 4],
        distance: { value: 4, units: 'Mm' },
      }),
      { checkpoint: true }
    )
  })

  it('says what to select when the selection is not dimensionable', async () => {
    const app = setup()
    await app.session.enter()
    app.session.select(3)

    app.session.applyDimension()
    await settled()

    expect(app.frontend.addConstraint).not.toHaveBeenCalled()
    expect(app.session.error.value).toMatch(/two points/)
  })

  /*
   * An expression, not a number: dimensions are written into the KCL, so the
   * value can be `2 * width` as easily as `40`.
   */
  it('sets a dimension from an expression', async () => {
    const app = setup()
    await app.session.enter()

    app.session.setDimension(7, '2 * width')
    await vi.waitFor(() =>
      expect(app.frontend.editConstraintValue).toHaveBeenCalledTimes(1)
    )

    expect(app.frontend.editConstraintValue).toHaveBeenCalledWith(
      0,
      7,
      '2 * width',
      { checkpoint: true }
    )
  })
})

describe('owning the camera', () => {
  it('takes the camera on the way in and hands it back on the way out', async () => {
    const app = setup()

    await app.session.enter()

    /*
     * Claimed for the whole session, not just while a tool is equipped.
     *
     * The sketch is drawn over the video from wherever the camera is, so an
     * unclaimed camera means the drawing arrives one engine report behind the
     * pointer — which reads as the app being slow however fast the solve was.
     */
    expect(app.camera.claimCamera).toHaveBeenCalledTimes(1)
    expect(app.camera.releaseCamera).not.toHaveBeenCalled()

    await app.session.exit()

    expect(app.camera.releaseCamera).toHaveBeenCalledTimes(1)
  })

  it('takes it even when the view is left where it was', async () => {
    const app = setup({ faceOnEntry: false })

    await app.session.enter()

    // Two different questions: whether to square up to the plane is a
    // preference, whether the overlay keeps up with the pointer is not.
    expect(app.camera.faceOn).not.toHaveBeenCalled()
    expect(app.camera.claimCamera).toHaveBeenCalledTimes(1)
  })

  it('hands it back when the sketch is forgotten rather than left', async () => {
    const closed = signal(false)
    const app = setup({ bufferGone: closed })
    await app.session.enter()

    closed.value = true
    await vi.waitFor(() => expect(app.session.open.value).toBeNull())

    // The buffer went away underneath an open session. Nothing can be written
    // back, but a camera the app is still steering would leave orbiting broken
    // in a scene with no sketch in it.
    expect(app.camera.releaseCamera).toHaveBeenCalled()
  })
})

describe('when the file goes away', () => {
  /*
   * The worst kind of stale state: without this the session stayed open over a
   * closed file, the toolbar still offered tools, and a click still asked the
   * solver to add a segment — into a copy of a file nobody had open.
   */
  it('forgets the sketch when its buffer closes', async () => {
    const closed = signal(false)
    const app = setup({ bufferGone: closed })
    await app.session.enter()
    app.session.equip('line')

    closed.value = true
    await vi.waitFor(() => expect(app.session.open.value).toBeNull())

    expect(app.session.tool.value).toBeNull()
    expect(app.session.draft.value).toEqual({ kind: 'idle' })
  })

  it('does not write anything back on the way out', async () => {
    const closed = signal(false)
    const app = setup({ bufferGone: closed })
    await app.session.enter()

    closed.value = true
    await vi.waitFor(() => expect(app.session.open.value).toBeNull())

    // `exit` would write and ask for a run, and there is neither to do it with:
    // the file on disk is whatever the last write left, which is what closing a
    // file means.
    expect(app.frontend.exitSketch).not.toHaveBeenCalled()
  })
})
