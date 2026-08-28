import type { SceneGraph } from '@rust/kcl-lib/bindings/FrontendApi'
import { describe, expect, it, vi } from 'vitest'
import type { KclContextHandle } from '@src/contracts/kclContext'
import { createKclFrontend } from '@src/features/kclFrontend/createKclFrontend'

const graph = (sketchMode: number | null = 5) =>
  ({ objects: [], sketch_mode: sketchMode }) as unknown as SceneGraph

const outcome = (text: string, options: { invalidates?: boolean } = {}) => ({
  sourceDelta: { text },
  sceneGraphDelta: {
    new_graph: graph(),
    new_objects: [7],
    invalidates_ids: options.invalidates ?? false,
  },
  checkpointId: 3,
})

const setup = (options: { context?: boolean } = {}) => {
  const calls: { name: string; args: unknown[] }[] = []
  const record =
    (name: string, result: unknown = undefined) =>
    (...args: unknown[]) => {
      calls.push({ name, args })
      return Promise.resolve(result)
    }

  const context = {
    open_project: record('open_project'),
    update_file: record('update_file'),
    edit_sketch: record('edit_sketch', outcome('')),
    exit_sketch: record('exit_sketch', outcome('exited = 1\n')),
    add_segment: record('add_segment', outcome('drawn = 1\n')),
    sketch_execute_mock: record('sketch_execute_mock'),
  } as unknown as KclContextHandle['context']

  const frontend = createKclFrontend({
    context: () =>
      options.context === false
        ? null
        : Promise.resolve({
            context,
            wasm: {},
            defaultSettings: {},
          } as KclContextHandle),
    settings: () => '{"units":"mm"}',
  })

  return { frontend, calls }
}

describe('mirroring the buffer into the frontend', () => {
  /*
   * `open_project` replaces the frontend's whole idea of the project, so calling
   * it per keystroke would throw away the sketch state that makes editing cheap.
   */
  it('opens the project once, then updates the file', async () => {
    const app = setup()

    await app.frontend.sync('main.kcl', 'a = 1\n')
    await app.frontend.sync('main.kcl', 'a = 2\n')
    await app.frontend.sync('main.kcl', 'a = 3\n')

    expect(app.calls.map((call) => call.name)).toEqual([
      'open_project',
      'update_file',
      'update_file',
    ])
  })

  it('re-opens when the file being mirrored changes', async () => {
    const app = setup()

    await app.frontend.sync('main.kcl', 'a = 1\n')
    await app.frontend.sync('other.kcl', 'b = 2\n')

    expect(app.calls.map((call) => call.name)).toEqual([
      'open_project',
      'open_project',
    ])
  })

  it('sends the text the buffer has', async () => {
    const app = setup()

    await app.frontend.sync('main.kcl', 'a = 1\n')

    expect(app.calls[0].args[1]).toBe(
      JSON.stringify([{ id: 0, path: 'main.kcl', text: 'a = 1\n' }])
    )
  })

  /* Nothing has executed yet, which is a state rather than a failure. */
  it('does nothing at all without a context', async () => {
    const app = setup({ context: false })

    await app.frontend.sync('main.kcl', 'a = 1\n')

    expect(app.calls).toEqual([])
    expect(app.frontend.ready.value).toBe(false)
  })

  it('is ready once a project is open', async () => {
    const app = setup()
    expect(app.frontend.ready.value).toBe(false)

    await app.frontend.sync('main.kcl', 'a = 1\n')

    expect(app.frontend.ready.value).toBe(true)
  })
})

describe('editing a sketch through the frontend', () => {
  it('opens one, and publishes the scene it answers with', async () => {
    const app = setup()

    const result = await app.frontend.editSketch(5)

    expect(app.calls.map((call) => call.name)).toEqual(['edit_sketch'])
    expect(result.graph.sketch_mode).toBe(5)
    expect(app.frontend.sceneGraph.value?.sketch_mode).toBe(5)
  })

  it('answers a mutation with the whole new text', async () => {
    const app = setup()

    const result = await app.frontend.addSegment(5, {
      type: 'Line',
      start: { x: { value: 0, units: 'Mm' }, y: { value: 0, units: 'Mm' } },
      end: { x: { value: 5, units: 'Mm' }, y: { value: 5, units: 'Mm' } },
    } as never)

    expect(result.text).toBe('drawn = 1\n')
    expect(result.newObjects).toEqual([7])
    expect(result.checkpointId).toBe(3)
  })

  /* A tool that draws several segments checkpoints on its last one. */
  it('checkpoints by default, and can be told not to', async () => {
    const app = setup()

    await app.frontend.addSegment(5, { type: 'Point' } as never)
    await app.frontend.addSegment(5, { type: 'Point' } as never, {
      checkpoint: false,
    })

    expect(app.calls[0].args[5]).toBe(true)
    expect(app.calls[1].args[5]).toBe(false)
  })

  it('passes ids and settings as the JSON the boundary wants', async () => {
    const app = setup()

    await app.frontend.editSketch(12)

    expect(app.calls[0].args).toEqual(['0', '0', '0', '12', '{"units":"mm"}'])
  })

  /*
   * Ids are indices into the graph, so a renumbering makes every held one point
   * at something else. Reporting it is what lets a caller drop them.
   */
  it('reports when the ids it had are no longer meaningful', async () => {
    const app = setup()

    expect((await app.frontend.editSketch(5)).invalidatesIds).toBe(false)
  })

  it('refuses to mutate before anything has executed', async () => {
    const app = setup({ context: false })

    await expect(app.frontend.editSketch(5)).rejects.toThrow(/not loaded/)
  })
})
