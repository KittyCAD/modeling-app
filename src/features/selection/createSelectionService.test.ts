import type { Artifact } from '@rust/kcl-lib/bindings/Artifact'
import { computed, signal } from '@preact/signals'
import { describe, expect, it, vi } from 'vitest'
import type { KclSceneService } from '@src/contracts/kclScene'
import type { ScenePoint } from '@src/contracts/scene'
import type { ScenePicker } from '@src/contracts/selection'
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
  } = {}
) {
  const queue = [...(options.picks ?? ['wall'])]
  const asked: ScenePoint[] = []

  const picker: ScenePicker = {
    id: 'fake',
    ready: computed(() => options.ready ?? true),
    pick: async (point) => {
      asked.push(point)
      if (options.fail) throw new Error('the engine went away')
      return queue.shift() ?? null
    },
  }

  const scene: KclSceneService = {
    artifacts: computed(() => artifacts),
    artifactFor: (id) => artifacts.get(id),
    sourceRangeFor: (id) => sourceRangeFor(artifacts, id),
  }

  const selection = createSelectionService({
    picker: () => picker,
    scene: () => (options.scene === false ? undefined : scene),
  })

  return { selection, asked }
}

describe('selecting by clicking', () => {
  it('names what was picked, walking the graph for the source', async () => {
    const { selection } = setup({ picks: ['wall'] })

    await selection.selectAt(at)

    expect(selection.entities.value).toEqual([
      // The wall carries no code of its own, so the answer is the segment that
      // drew it.
      { entityId: 'wall', kind: 'wall', sourceRange: [40, 70, 0] },
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
      { entityId: 'mystery', kind: null, sourceRange: null },
    ])
  })

  it('works with no artifact graph at all', async () => {
    const { selection } = setup({ picks: ['wall'], scene: false })

    await selection.selectAt(at)

    expect(selection.entities.value).toEqual([
      { entityId: 'wall', kind: null, sourceRange: null },
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
      { entityId: 'seg', kind: 'segment', sourceRange: [40, 70, 0] },
    ])

    selection.clear()
    expect(selection.entities.value).toEqual([])
  })
})
