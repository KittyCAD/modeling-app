import type { SceneGraph } from '@rust/kcl-lib/bindings/FrontendApi'
import { signal } from '@preact/signals'
import { describe, expect, it, vi } from 'vitest'
import { combineCapabilities } from '@src/contracts/buffers'
import { requestExecution } from '@src/lib/buffers/annotations'
import type {
  KclFrontendService,
  SetProgramResult,
} from '@src/contracts/kclFrontend'
import type { SceneProjection } from '@src/contracts/sceneProjection'
import type { Artifact } from '@rust/kcl-lib/bindings/Artifact'
import type { ArtifactMap } from '@src/lib/kcl/artifacts'
import { createSketchSession } from '@src/features/sketchMode/createSketchSession'
import { createFileBackedTextBuffer } from '@src/lib/buffers/createFileBackedTextBuffer'
import type { SketchBlockRange } from '@src/lib/kclStdlib/program'

const SOURCE = 's = sketch(on = XY) {\n}\n'

/** A graph whose one sketch is written where the fixture's sketch is. */
const graph = (): SceneGraph =>
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
        source: { type: 'Simple', range: [0, 23, 0], node_path: null },
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

const setup = (
  options: {
    sketch?: SketchBlockRange | null
    program?: unknown
    setProgram?: () => Promise<SetProgramResult>
    exitThrows?: boolean
    artifacts?: ArtifactMap
    projection?: SceneProjection
    addSegment?: (calls: string[]) => Promise<unknown>
  } = {}
) => {
  const buffer = createFileBackedTextBuffer({
    path: '/projects/bracket/main.kcl',
    contents: SOURCE,
    languageId: 'kcl',
    capabilities: combineCapabilities([]),
  })

  const calls: string[] = []
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
        Promise.resolve({ text: SOURCE }))) as never
    }),
  } as unknown as KclFrontendService

  const session = createSketchSession({
    frontend: () => frontend,
    sketch: signal(
      options.sketch === undefined
        ? { name: 's', from: 0, to: 23 }
        : options.sketch
    ),
    buffer: () => buffer,
    path: () => 'main.kcl',
    program: () =>
      options.program === undefined ? { body: [] } : options.program,
    artifacts: () => options.artifacts ?? onXY,
    projection: () => options.projection,
  })

  return { session, buffer, frontend, calls }
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

    // Names the offset, because this one is a bug in the crossing between our
    // text ranges and the frontend's ids and nobody can act on it without one.
    expect(app.session.error.value).toMatch(/no sketch at offset 900/)
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

  it('collects the first click without asking the frontend for anything', async () => {
    const app = await enterWithLine()

    app.session.place({ x: 0, y: 0 })

    expect(app.frontend.addSegment).not.toHaveBeenCalled()
    expect(app.session.tool.value?.points).toHaveLength(1)
  })

  it('draws the segment on the second click', async () => {
    const app = await enterWithLine()

    app.session.place({ x: 0, y: 0 })
    app.session.place({ x: 10, y: 0 })
    await vi.waitFor(() =>
      expect(app.frontend.addSegment).toHaveBeenCalledTimes(1)
    )

    expect(app.frontend.addSegment).toHaveBeenCalledWith(0, {
      type: 'Line',
      start: {
        x: { type: 'Number', value: 0, units: 'Mm' },
        y: { type: 'Number', value: 0, units: 'Mm' },
      },
      end: {
        x: { type: 'Number', value: 10, units: 'Mm' },
        y: { type: 'Number', value: 0, units: 'Mm' },
      },
    })
  })

  /*
   * The whole point of a session: the file is the model and it updates as you
   * draw, but nothing is rebuilt until you are finished.
   */
  it('writes each segment into the file without running it', async () => {
    const DRAWN = 's = sketch(on = XY) {\n  l1 = line()\n}\n'
    const app = await enterWithLine({
      addSegment: async () => ({ text: DRAWN }),
    })

    app.session.place({ x: 0, y: 0 })
    app.session.place({ x: 10, y: 0 })
    await vi.waitFor(() => expect(app.buffer.text.value).toBe(DRAWN))
  })

  it('runs the mutations in the order they were asked for', async () => {
    // Two overlapping solves would each answer with text missing the other's
    // segment, and the second to land would erase the first.
    const app = await enterWithLine({
      addSegment: async (calls) => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        calls.push('solved')
        return { text: SOURCE }
      },
    })

    app.session.place({ x: 0, y: 0 })
    app.session.place({ x: 1, y: 0 })
    app.session.place({ x: 2, y: 0 })
    app.session.place({ x: 3, y: 0 })

    await vi.waitFor(() =>
      expect(app.calls.filter((call) => call === 'solved')).toHaveLength(2)
    )
    expect(app.calls.slice(-4)).toEqual([
      'addSegment',
      'solved',
      'addSegment',
      'solved',
    ])
  })

  it('keeps the tool but forgets the half-drawn line when cancelled', async () => {
    const app = await enterWithLine()
    app.session.place({ x: 0, y: 0 })

    app.session.cancelTool()

    expect(app.session.tool.value).toEqual({ tool: 'line', points: [] })
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
