import { computed, signal } from '@preact/signals'
import { beforeEach, describe, expect, it } from 'vitest'
import type {
  AreaDefinition,
  DockNode,
  LayoutNode,
  LayoutPreset,
} from '@src/contracts/layout'
import { createLayoutService } from '@src/features/layout/createLayoutService'

const area = (id: string, available?: boolean): AreaDefinition => ({
  id,
  title: id,
  icon: 'folder',
  available: available === undefined ? undefined : computed(() => available),
  render: () => null,
})

const buildLayout = (): DockNode => ({
  type: 'dock',
  id: 'dock',
  start: {
    type: 'rail',
    id: 'rail.start',
    side: 'inline-start',
    areaIds: ['files', 'outline'],
    openAreaIds: ['files'],
    size: 280,
  },
  end: {
    type: 'rail',
    id: 'rail.end',
    side: 'inline-end',
    areaIds: ['info'],
    openAreaIds: [],
    size: 300,
  },
  center: {
    type: 'split',
    id: 'center',
    orientation: 'inline',
    sizes: [0.4, 0.6],
    children: [
      { type: 'area', id: 'center.editor', areaId: 'editor' },
      { type: 'area', id: 'center.viewport', areaId: 'viewport' },
    ],
  },
})

const preset: LayoutPreset = {
  id: 'modeling',
  title: 'Modeling',
  build: buildLayout,
}

function create(
  areas: AreaDefinition[] = [area('files'), area('outline'), area('info')]
) {
  return createLayoutService(
    computed(() => areas),
    computed(() => [preset])
  )
}

describe('layout service', () => {
  let layout: ReturnType<typeof create>

  beforeEach(() => {
    layout = create()
    layout.applyPreset('modeling')
  })

  it('starts with no layout at all, so a screen can decide when to seed one', () => {
    // The outer beforeEach has already applied and persisted a preset, so drop
    // that first: this is about a genuinely first run.
    localStorage.clear()
    const fresh = create()
    expect(fresh.root.value).toBeNull()
    expect(fresh.presetId.value).toBeNull()
  })

  it('applies a preset', () => {
    expect(layout.presetId.value).toBe('modeling')
    expect(layout.root.value?.type).toBe('dock')
  })

  it('ignores an unknown preset rather than blanking the layout', () => {
    layout.applyPreset('nope')
    expect(layout.presetId.value).toBe('modeling')
    expect(layout.root.value).not.toBeNull()
  })

  it('hides areas a feature reports unavailable', () => {
    const hidden = create([area('files'), area('info', false)])
    expect(hidden.areas.value.map((a) => a.id)).toEqual(['files'])
    // Lookup by id still resolves, so a persisted layout can find it again.
    expect(hidden.area('info')?.id).toBe('info')
  })

  it('reports which areas are open', () => {
    expect(layout.isAreaOpen('files').value).toBe(true)
    expect(layout.isAreaOpen('info').value).toBe(false)
    expect(layout.isAreaOpen('nonexistent').value).toBe(false)
  })

  it('reports an area placed directly in the tree as open', () => {
    expect(layout.isAreaOpen('editor').value).toBe(true)
  })

  it('toggles an area in a rail', () => {
    layout.toggleArea('info')
    expect(layout.isAreaOpen('info').value).toBe(true)

    layout.toggleArea('info')
    expect(layout.isAreaOpen('info').value).toBe(false)
  })

  /**
   * A hosted area is drawn by another area, but its state still lives in the
   * rail that lists it — that is the whole of what `hostedBy` relies on. Drop
   * the id from the rail and the file tree becomes untoggleable and unpersisted.
   */
  it('toggles a hosted area through the rail that lists it', () => {
    const hosted = create([
      area('files'),
      { ...area('outline'), hostedBy: 'files' },
      area('info'),
    ])
    hosted.applyPreset('modeling')

    expect(hosted.isAreaOpen('outline').value).toBe(false)
    hosted.toggleArea('outline')
    expect(hosted.isAreaOpen('outline').value).toBe(true)
  })

  it('ignores a toggle for an area that belongs to no rail', () => {
    const before = layout.root.value
    layout.toggleArea('editor')
    expect(layout.root.value).toBe(before)
  })

  it('opens and closes idempotently', () => {
    layout.openArea('info')
    layout.openArea('info')
    const rail = (layout.root.value as DockNode).end
    expect(rail?.openAreaIds).toEqual(['info'])

    layout.closeArea('info')
    layout.closeArea('info')
    expect((layout.root.value as DockNode).end?.openAreaIds).toEqual([])
  })

  it('collapses a rail to nothing, which is a supported state', () => {
    layout.closeArea('files')
    expect((layout.root.value as DockNode).start?.openAreaIds).toEqual([])
  })

  it('hands out the same sizes signal for a node every time', () => {
    // Identity matters: Split writes to this signal, so a second copy would
    // silently diverge from the service.
    expect(layout.sizesFor('center')).toBe(layout.sizesFor('center'))
  })

  it('seeds sizes from the preset', () => {
    expect(layout.sizesFor('center').value).toEqual([0.4, 0.6])
  })

  it('seeds an unknown node with an even split rather than throwing', () => {
    expect(layout.sizesFor('not-in-tree').value).toEqual([0.5, 0.5])
  })

  it('hands out a stable extent signal with a caller fallback', () => {
    const extent = layout.extentFor('rail.start', 320)
    expect(extent.value).toBe(320)
    expect(layout.extentFor('rail.start')).toBe(extent)
  })

  it('restores sizes, extents, and open areas from storage', () => {
    layout.sizesFor('center').value = [0.8, 0.2]
    layout.extentFor('rail.start').value = 400
    layout.openArea('info')
    layout.dispose()

    const restored = create()
    expect(restored.root.value?.type).toBe('dock')
    expect(restored.sizesFor('center').value).toEqual([0.8, 0.2])
    expect(restored.extentFor('rail.start').value).toBe(400)
    expect(restored.isAreaOpen('info').value).toBe(true)
  })

  it('resets sizes as well as the arrangement', () => {
    layout.sizesFor('center').value = [0.9, 0.1]
    layout.extentFor('rail.start').value = 400
    layout.openArea('info')

    layout.reset()

    // A pane that had not been measured yet must not come back at its old
    // width from the restored payload.
    expect(layout.sizesFor('center').value).toEqual([0.4, 0.6])
    expect(layout.extentFor('rail.start', 280).value).toBe(280)
    expect(layout.isAreaOpen('info').value).toBe(false)
  })

  it('hands out fresh signals after a reset', () => {
    const before = layout.sizesFor('center')
    layout.reset()
    expect(layout.sizesFor('center')).not.toBe(before)
  })

  it('survives corrupt stored layout data', () => {
    localStorage.setItem('zds.layout', 'not json at all')
    expect(create().root.value).toBeNull()
  })

  it('ignores a stored payload from a future version', () => {
    localStorage.setItem('zds.layout', JSON.stringify({ version: 99 }))
    expect(create().root.value).toBeNull()
  })

  it('tracks areas reactively as features come and go', () => {
    const areas = signal<AreaDefinition[]>([area('files')])
    const dynamic = createLayoutService(
      computed(() => areas.value),
      computed(() => [preset])
    )

    expect(dynamic.areas.value).toHaveLength(1)
    areas.value = [area('files'), area('info')]
    expect(dynamic.areas.value).toHaveLength(2)
  })

  it('walks nested splits when looking for a node', () => {
    const nested: LayoutPreset = {
      id: 'nested',
      title: 'Nested',
      build: (): LayoutNode => ({
        type: 'split',
        id: 'outer',
        orientation: 'inline',
        sizes: [0.5, 0.5],
        children: [
          { type: 'area', id: 'a', areaId: 'files' },
          {
            type: 'split',
            id: 'inner',
            orientation: 'block',
            sizes: [0.3, 0.7],
            children: [
              { type: 'area', id: 'b', areaId: 'info' },
              { type: 'area', id: 'c', areaId: 'outline' },
            ],
          },
        ],
      }),
    }

    const service = createLayoutService(
      computed(() => [area('files'), area('info'), area('outline')]),
      computed(() => [nested])
    )
    service.applyPreset('nested')

    expect(service.sizesFor('inner').value).toEqual([0.3, 0.7])
  })
})
