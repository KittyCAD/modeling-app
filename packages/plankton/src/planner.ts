import type { Binding, Extension, Key, Factory } from './algebra'
import { itemKey } from './algebra'
import { formatPath, type ItemPath } from './path'

/** A unique executable item and the path where planning first encountered it. */
interface PlannedItem {
  readonly item: Binding | Factory
  readonly path: ItemPath
}

/** Paths describe the active traversal from a repeated identity back to itself. */
export class DependencyCycleError extends Error {
  constructor(readonly paths: readonly ItemPath[]) {
    super(`Cyclic item dependency: ${paths.map(formatPath).join(' -> ')}`)
    this.name = 'DependencyCycleError'
  }
}

/** Expand declared dependencies, without installing bindings or acquiring children. */
export function plan(
  items: readonly Extension[],
  selected: ReadonlyMap<Key, Extension> = new Map()
): readonly PlannedItem[] {
  const result: PlannedItem[] = []
  const completed = new Set<Key>()
  const active = new Map<Key, ItemPath>()

  const visit = (item: Extension, path: ItemPath): void => {
    const key = itemKey(item)
    const winner = selected.get(key)
    if (winner !== undefined && winner !== item) return
    const start = active.get(key)
    if (start !== undefined) {
      const paths = [...active.values()]
      throw new DependencyCycleError([
        ...paths.slice(paths.indexOf(start)),
        path,
      ])
    }
    if (completed.has(key)) return
    active.set(key, path)

    if ('create' in item) {
      for (const [name, dependency] of Object.entries(item.dependencies ?? {}))
        visit(dependency, [...path, ['dependencies', name]])
      result.push({ item, path })
    } else if ('install' in item) {
      result.push({ item, path })
    } else {
      item.forEach((child, index) => visit(child, [...path, ['items', index]]))
    }

    active.delete(key)
    completed.add(key)
  }

  items.forEach((item, index) => visit(item, [index]))
  return result
}
