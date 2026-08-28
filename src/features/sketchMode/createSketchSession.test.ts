import type { SceneGraph } from '@rust/kcl-lib/bindings/FrontendApi'
import { signal } from '@preact/signals'
import { describe, expect, it, vi } from 'vitest'
import { combineCapabilities } from '@src/contracts/buffers'
import type { KclFrontendService } from '@src/contracts/kclFrontend'
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

const setup = (
  options: {
    sketch?: SketchBlockRange | null
    program?: unknown
    setProgram?: () => Promise<SceneGraph | null>
    exitText?: string
    exitThrows?: boolean
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
        (async () => {
          calls.push('setProgram')
          return graph()
        })
    ),
    editSketch: vi.fn(async () => {
      calls.push('editSketch')
      return {} as never
    }),
    exitSketch: vi.fn(async () => {
      calls.push('exitSketch')
      if (options.exitThrows) throw new Error('the frontend gave up')
      return { text: options.exitText ?? SOURCE } as never
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
    expect(app.session.open.value).toEqual({ sketchId: 0, name: 's' })
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

  it('reports a program that would not build a scene', async () => {
    const app = setup({ setProgram: async () => null })

    await app.session.enter()

    expect(app.session.error.value).toMatch(/has to run/)
    expect(app.session.open.value).toBeNull()
  })

  it('reports a run whose scene has no sketch there', async () => {
    const app = setup({ sketch: { name: 's', from: 900, to: 950 } })

    await app.session.enter()

    expect(app.session.error.value).toMatch(/does not have a sketch/)
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
  const DRAWN = 's = sketch(on = XY) {\n  l1 = line()\n}\n'

  it('writes the sketch back as one edit', async () => {
    const app = setup({ exitText: DRAWN })
    await app.session.enter()

    await app.session.exit()

    expect(app.buffer.text.value).toBe(DRAWN)
    expect(app.session.open.value).toBeNull()
  })

  /* One transaction is one undo entry for the whole sketch, and one run. */
  it('writes it in a single transaction', async () => {
    const app = setup({ exitText: DRAWN })
    await app.session.enter()
    const before = app.buffer.version.value

    await app.session.exit()

    expect(app.buffer.version.value).toBe(before + 1)
  })

  it('writes nothing when the sketch came back unchanged', async () => {
    const app = setup()
    await app.session.enter()
    const before = app.buffer.version.value

    await app.session.exit()

    expect(app.buffer.version.value).toBe(before)
  })

  /*
   * Being unable to write back is bad; being stuck in a session that cannot be
   * left is worse, and the text is still in the frontend.
   */
  it('closes even when writing back fails', async () => {
    const app = setup({ exitThrows: true })
    await app.session.enter()

    await app.session.exit()

    expect(app.session.open.value).toBeNull()
    expect(app.session.error.value).toMatch(/gave up/)
  })

  it('does nothing when no sketch is open', async () => {
    const app = setup()

    await app.session.exit()

    expect(app.frontend.exitSketch).not.toHaveBeenCalled()
  })
})
