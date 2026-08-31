import type { SceneGraph } from '@rust/kcl-lib/bindings/FrontendApi'
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
    addSegment?: (calls: string[]) => Promise<unknown>
    /** Makes a preview solve take long enough for moves to pile up behind it. */
    slowEdit?: boolean
    /** Flips to true to stand in for the executing buffer being closed. */
    bufferGone?: { value: boolean }
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
  const frontend = {
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
      return (await (options.addSegment?.(calls) ??
        Promise.resolve(drawnOutcome()))) as never
    }),
    editSegments: vi.fn(async () => {
      calls.push('editSegments')
      if (options.slowEdit) {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      return drawnOutcome() as never
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

describe('dragging a point', () => {
  /*
   * The bug this covers is the whole reason dragging felt broken: `moveTo`
   * required an equipped tool, a drag equips nothing, and so nothing moved until
   * the release — when the geometry jumped to where the pointer had ended up.
   */
  it('previews every move, with no tool equipped', async () => {
    const app = setup()
    await app.session.enter()

    app.session.beginDrag(1)
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
      { commit: false, checkpoint: false }
    )
  })

  it('commits where the release landed', async () => {
    const app = setup()
    await app.session.enter()

    app.session.beginDrag(1)
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
        { commit: true, checkpoint: true }
      )
    )

    expect(app.session.draft.value).toEqual({ kind: 'idle' })
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
