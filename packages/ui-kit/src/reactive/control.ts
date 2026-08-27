import { type ReadonlySignal, computed, signal } from '@preact/signals-core'
import {
  type Child,
  type Reactive,
  appendChild,
  bind,
  dynamic,
  isSignal,
  peek,
} from './dom'
import { onDispose, runInScope } from './scope'

/**
 * Conditional rendering.
 *
 * The condition is narrowed to a boolean through a `computed` first, so the
 * branch is only rebuilt when the answer actually flips — not every time
 * something the predicate touched changed.
 */
export function when(
  condition: Reactive<unknown>,
  then: () => Child,
  otherwise?: () => Child
): DocumentFragment {
  const truthy = computed(() => {
    if (isSignal(condition)) return Boolean(condition.value)
    if (typeof condition === 'function')
      return Boolean((condition as () => unknown)())
    return Boolean(condition)
  })

  return dynamic(() => (truthy.value ? then() : otherwise?.()))
}

/**
 * Keep a node mounted and toggle its visibility.
 *
 * Preferred over `when` for expensive subtrees that should retain their state
 * (scroll position, a live editor, a WebGL canvas) while hidden.
 */
export function show(condition: Reactive<unknown>, child: Child): Child {
  const node = child instanceof Node ? child : document.createElement('div')
  if (!(child instanceof Node)) appendChild(node, child)

  bind(
    () => {
      if (isSignal(condition)) return Boolean(condition.value)
      if (typeof condition === 'function')
        return Boolean((condition as () => unknown)())
      return Boolean(condition)
    },
    (visible) => {
      if (node instanceof HTMLElement) node.hidden = !visible
    }
  )

  return node
}

/** Pick one branch out of a map, keyed by a discriminant. */
export function switchOn<K extends string | number | symbol>(
  discriminant: Reactive<K>,
  cases: Partial<Record<K, () => Child>> & { _?: () => Child }
): DocumentFragment {
  const key = computed(() => {
    if (isSignal<K>(discriminant)) return discriminant.value
    if (typeof discriminant === 'function') return (discriminant as () => K)()
    return discriminant
  })

  return dynamic(() => (cases[key.value] ?? cases._)?.())
}

interface EachEntry<T> {
  key: unknown
  item: ReturnType<typeof signal<T>>
  index: ReturnType<typeof signal<number>>
  nodes: Node[]
  dispose: () => void
}

export interface EachOptions<T> {
  /**
   * Stable identity per item. Defaults to the item itself, which is correct for
   * primitives and for object lists that are never re-created.
   */
  key?: (item: T, index: number) => unknown
  /** Rendered when the list is empty. */
  empty?: () => Child
}

/**
 * Keyed list rendering.
 *
 * Rows that keep their key are never rebuilt; their `item` and `index` signals
 * are written to instead, and the DOM is only re-ordered. That means a row
 * holding focus, a text selection, or an open menu survives a reorder of the
 * list around it.
 *
 * `render` receives signals rather than plain values precisely because a row
 * can outlive any particular version of its data.
 */
export function each<T>(
  items: Reactive<readonly T[]>,
  render: (
    item: ReadonlySignal<T>,
    index: ReadonlySignal<number>,
    key: unknown
  ) => Child,
  options: EachOptions<T> = {}
): DocumentFragment {
  const fragment = document.createDocumentFragment()
  const start = document.createComment('')
  const end = document.createComment('')
  fragment.append(start, end)

  const keyOf = options.key ?? ((item: T) => item)
  let entries: EachEntry<T>[] = []
  let emptyRegion: { nodes: Node[]; dispose: () => void } | null = null

  const parentOf = () => end.parentNode

  const clearEmpty = () => {
    if (!emptyRegion) return
    emptyRegion.dispose()
    for (const node of emptyRegion.nodes) node.parentNode?.removeChild(node)
    emptyRegion = null
  }

  const createEntry = (item: T, index: number, key: unknown): EachEntry<T> => {
    const itemSignal = signal(item)
    const indexSignal = signal(index)
    const built = runInScope(() => {
      const frag = document.createDocumentFragment()
      appendChild(frag, render(itemSignal, indexSignal, key))
      return frag
    })
    // Capture the nodes before the fragment is drained by insertion.
    const nodes = Array.from(built.value.childNodes)
    // An entry with no nodes cannot be positioned; anchor it with a marker.
    if (nodes.length === 0) {
      const anchor = document.createComment('')
      built.value.appendChild(anchor)
      nodes.push(anchor)
    }
    return {
      key,
      item: itemSignal,
      index: indexSignal,
      nodes,
      dispose: () => {
        built.dispose()
        for (const node of nodes) node.parentNode?.removeChild(node)
      },
    }
  }

  const reconcile = (next: readonly T[]) => {
    const parent = parentOf()
    if (!parent) return

    if (next.length === 0) {
      for (const entry of entries) entry.dispose()
      entries = []
      if (!emptyRegion && options.empty) {
        const built = runInScope(() => {
          const frag = document.createDocumentFragment()
          appendChild(frag, options.empty?.())
          return frag
        })
        const nodes = Array.from(built.value.childNodes)
        parent.insertBefore(built.value, end)
        emptyRegion = { nodes, dispose: built.dispose }
      }
      return
    }

    clearEmpty()

    const previous = new Map<unknown, EachEntry<T>>()
    for (const entry of entries) {
      // Duplicate keys would collide; keep the first and let the later one rebuild.
      if (!previous.has(entry.key)) previous.set(entry.key, entry)
    }

    const nextEntries: EachEntry<T>[] = []
    const claimed = new Set<EachEntry<T>>()

    next.forEach((item, index) => {
      const key = keyOf(item, index)
      const existing = previous.get(key)
      if (existing && !claimed.has(existing)) {
        claimed.add(existing)
        if (existing.item.peek() !== item) existing.item.value = item
        if (existing.index.peek() !== index) existing.index.value = index
        nextEntries.push(existing)
        return
      }
      nextEntries.push(createEntry(item, index, key))
    })

    for (const entry of entries) {
      if (!claimed.has(entry)) entry.dispose()
    }

    // Walk the desired order, moving only the rows that are out of place.
    let cursor: Node | null = start.nextSibling
    for (const entry of nextEntries) {
      if (cursor === entry.nodes[0]) {
        for (const node of entry.nodes) cursor = node.nextSibling
        continue
      }
      for (const node of entry.nodes) parent.insertBefore(node, cursor)
    }

    entries = nextEntries
  }

  bind(() => {
    const value = isSignal<readonly T[]>(items)
      ? items.value
      : typeof items === 'function'
        ? (items as () => readonly T[])()
        : items
    return value ?? []
  }, reconcile)

  onDispose(() => {
    for (const entry of entries) entry.dispose()
    entries = []
    clearEmpty()
  })

  return fragment
}

/**
 * Render into a container elsewhere in the document.
 *
 * Used for overlays that must escape a clipping or stacking context. The
 * portalled nodes are still owned by the calling scope, so they disappear with
 * whatever created them.
 */
export function portal(target: Reactive<Element>, child: Child): Comment {
  const anchor = document.createComment('')
  const container = peek(target)

  const built = runInScope(() => {
    const frag = document.createDocumentFragment()
    appendChild(frag, child)
    return frag
  })
  const nodes = Array.from(built.value.childNodes)
  container.appendChild(built.value)

  onDispose(() => {
    built.dispose()
    for (const node of nodes) node.parentNode?.removeChild(node)
  })

  return anchor
}
