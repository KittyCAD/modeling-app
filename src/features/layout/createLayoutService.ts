import {
  type ReadonlySignal,
  type Signal,
  computed,
  effect,
  signal,
} from '@preact/signals'
import type {
  AreaDefinition,
  LayoutNode,
  LayoutPreset,
  LayoutService,
  RailNode,
} from '@src/contracts/layout'

const STORAGE_KEY = 'zds.layout'

/**
 * The saved arrangement.
 *
 * The version is the migration, and dropping the payload is the whole strategy:
 * node ids and structure belong to the preset that produced them, so a stored
 * tree from an older shape is worse than none — the screen re-seeds from the
 * current preset when there is nothing to restore.
 *
 * Bump it whenever a preset's structure or node ids change. Without that, an
 * existing install keeps the old layout forever and only "Reset panel layout"
 * shows the new one.
 *
 * - 1: files and the title block in rails, editor and viewport split down the
 *   middle.
 * - 2: the code panel (editor, hosting the file tree) in the start rail, with
 *   the viewport taking the whole centre.
 */
interface PersistedLayout {
  version: 2
  presetId: string | null
  root: LayoutNode | null
  sizes: Record<string, number[]>
  extents: Record<string, number>
}

function readPersisted(): PersistedLayout | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedLayout
    return parsed.version === 2 ? parsed : null
  } catch {
    return null
  }
}

/** Walk every node in a layout tree, parents before children. */
function* walk(node: LayoutNode | null | undefined): Generator<LayoutNode> {
  if (!node) return
  yield node
  if (node.type === 'split') {
    for (const child of node.children) yield* walk(child)
  }
  if (node.type === 'dock') {
    yield* walk(node.start)
    yield* walk(node.end)
    yield* walk(node.center)
  }
}

/** Structurally replace nodes throughout a tree, returning a new tree. */
function mapNode(
  node: LayoutNode,
  change: (candidate: LayoutNode) => LayoutNode
): LayoutNode {
  const next = change(node)

  if (next.type === 'split') {
    return {
      ...next,
      children: next.children.map((child) => mapNode(child, change)),
    }
  }

  if (next.type === 'dock') {
    return {
      ...next,
      start: next.start
        ? (mapNode(next.start, change) as typeof next.start)
        : undefined,
      end: next.end
        ? (mapNode(next.end, change) as typeof next.end)
        : undefined,
      center: mapNode(next.center, change),
    }
  }

  return next
}

/**
 * Owns the layout tree, pane sizes, and which areas are expanded.
 *
 * Two deliberate choices:
 *
 * Sizes are handed out as the writable signal itself rather than through a
 * setter. A `Split` writes to the same signal a restored layout wrote to, so
 * there is exactly one copy of "how big is everything" and no reconciliation
 * step between the component and the service.
 *
 * The tree is data, not components. A layout can therefore be serialised,
 * diffed, migrated, and contributed to — none of which is possible when the
 * arrangement is expressed as nested JSX.
 */
export function createLayoutService(
  areasSignal: ReadonlySignal<readonly AreaDefinition[]>,
  presetsSignal: ReadonlySignal<readonly LayoutPreset[]>
): LayoutService & { dispose: () => void } {
  const persisted = readPersisted()

  /**
   * Seeds for sizes that have not been asked for yet.
   *
   * Cleared when a preset is applied, so "Reset panel layout" actually resets
   * the sizes as well as the arrangement — otherwise a pane that had not been
   * measured yet would come back at its old width from the restored payload.
   */
  let seeds: Pick<PersistedLayout, 'sizes' | 'extents'> | null = persisted
    ? { sizes: persisted.sizes ?? {}, extents: persisted.extents ?? {} }
    : null

  const root = signal<LayoutNode | null>(persisted?.root ?? null)
  const presetId = signal<string | null>(persisted?.presetId ?? null)
  const sizeSignals = new Map<string, Signal<number[]>>()
  const extentSignals = new Map<string, Signal<number>>()
  /** Teardown for the persistence watchers attached to each size signal. */
  const watchers = new Map<string, () => void>()
  let persistTimer: number | undefined

  /** Only areas whose feature says they are available right now. */
  const areas = computed(() =>
    areasSignal.value.filter((area) => area.available?.value ?? true)
  )

  const area = (areaId: string) =>
    areasSignal.value.find((candidate) => candidate.id === areaId)

  const persist = () => {
    try {
      const payload: PersistedLayout = {
        version: 2,
        presetId: presetId.peek(),
        root: root.peek(),
        sizes: Object.fromEntries(
          [...sizeSignals].map(([nodeId, value]) => [nodeId, value.peek()])
        ),
        extents: Object.fromEntries(
          [...extentSignals].map(([nodeId, value]) => [nodeId, value.peek()])
        ),
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    } catch {
      // A layout that cannot be saved is still a layout that works.
    }
  }

  /**
   * Persist shortly after a change, rather than on every one.
   *
   * A drag writes a size sixty times a second; storage does not need to see any
   * of the intermediate values. Debouncing also means the watchers below can be
   * naive.
   */
  const schedulePersist = () => {
    window.clearTimeout(persistTimer)
    persistTimer = window.setTimeout(persist, 400)
  }

  /**
   * Watch one size signal so a resize survives a reload.
   *
   * Relying on `pagehide` alone loses work whenever the page goes away in a way
   * that does not fire it — a crash, a hard reload, a killed tab.
   */
  const watch = (key: string, source: Signal<unknown>) => {
    let first = true
    watchers.get(key)?.()
    watchers.set(
      key,
      effect(() => {
        source.value
        if (first) {
          first = false
          return
        }
        schedulePersist()
      })
    )
  }

  const sizesFor = (nodeId: string) => {
    const existing = sizeSignals.get(nodeId)
    if (existing) return existing

    // Prefer a persisted value; otherwise seed from the tree so a preset's own
    // proportions are the starting point.
    const stored = seeds?.sizes?.[nodeId]
    const node = [...walk(root.peek())].find(
      (candidate) => candidate.id === nodeId
    )
    const seed =
      stored ?? (node?.type === 'split' ? node.sizes.slice() : [0.5, 0.5])

    const created = signal(seed)
    sizeSignals.set(nodeId, created)
    watch(`sizes:${nodeId}`, created)
    return created
  }

  const extentFor = (nodeId: string, fallback = 280) => {
    const existing = extentSignals.get(nodeId)
    if (existing) return existing

    const created = signal(seeds?.extents?.[nodeId] ?? fallback)
    extentSignals.set(nodeId, created)
    watch(`extent:${nodeId}`, created)
    return created
  }

  const railsWithArea = (areaId: string) =>
    [...walk(root.value)].filter(
      (node): node is RailNode =>
        node.type === 'rail' && node.areaIds.includes(areaId)
    )

  const isAreaOpen = (areaId: string) =>
    computed(() => {
      for (const node of walk(root.value)) {
        if (node.type === 'rail' && node.openAreaIds.includes(areaId))
          return true
        if (node.type === 'area' && node.areaId === areaId) return true
      }
      return false
    })

  const setOpenAreas = (
    areaId: string,
    change: (open: string[]) => string[]
  ) => {
    const current = root.peek()
    if (!current) return

    root.value = mapNode(current, (node) => {
      if (node.type !== 'rail' || !node.areaIds.includes(areaId)) return node
      return { ...node, openAreaIds: change(node.openAreaIds) }
    })
    persist()
  }

  const openArea = (areaId: string) =>
    setOpenAreas(areaId, (open) =>
      open.includes(areaId) ? open : [...open, areaId]
    )

  const closeArea = (areaId: string) =>
    setOpenAreas(areaId, (open) => open.filter((id) => id !== areaId))

  const toggleArea = (areaId: string) => {
    if (railsWithArea(areaId).length === 0) return
    setOpenAreas(areaId, (open) =>
      open.includes(areaId)
        ? open.filter((id) => id !== areaId)
        : [...open, areaId]
    )
  }

  const applyPreset = (nextPresetId: string) => {
    const preset = presetsSignal.value.find(
      (candidate) => candidate.id === nextPresetId
    )
    if (!preset) {
      console.warn(`layout: no preset "${nextPresetId}"`)
      return
    }
    // Sizes are cleared with the tree: node ids belong to the preset that
    // produced them, so keeping stale entries would size the wrong panes.
    for (const stop of watchers.values()) stop()
    watchers.clear()
    sizeSignals.clear()
    extentSignals.clear()
    seeds = null
    presetId.value = preset.id
    root.value = preset.build()
    persist()
  }

  const reset = () => {
    const current = presetId.peek() ?? presetsSignal.value[0]?.id
    if (current) applyPreset(current)
  }

  return {
    root: computed(() => root.value),
    presetId: computed(() => presetId.value),
    areas,
    area,
    sizesFor,
    extentFor,
    isAreaOpen,
    toggleArea,
    openArea,
    closeArea,
    applyPreset,
    reset,
    dispose: () => {
      window.clearTimeout(persistTimer)
      for (const stop of watchers.values()) stop()
      watchers.clear()
      persist()
    },
  }
}
