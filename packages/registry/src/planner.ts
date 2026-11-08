import type { Binding, Item, Subtree } from './algebra'
import { formatPath, type ItemPath } from './path'

/** A unique executable item and the path where planning first encountered it. */
export interface PlannedItem {
  readonly item: Binding | Subtree
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
export function plan(items: readonly Item[]): readonly PlannedItem[] {
  const result: PlannedItem[] = []
  const completed = new Set<Item>()
  const active = new Map<Item, ItemPath>()

  const visit = (item: Item, path: ItemPath): void => {
    const start = active.get(item)
    if (start !== undefined) {
      const paths = [...active.values()]
      throw new DependencyCycleError([
        ...paths.slice(paths.indexOf(start)),
        path,
      ])
    }
    if (completed.has(item)) return
    active.set(item, path)

    if ('create' in item) {
      item.dependencies?.forEach((dependency, index) =>
        visit(dependency, [...path, ['dependencies', index]])
      )
      result.push({ item, path })
    } else if ('install' in item) {
      result.push({ item, path })
    } else {
      item.forEach((child, index) => visit(child, [...path, ['items', index]]))
    }

    active.delete(item)
    completed.add(item)
  }

  items.forEach((item, index) => visit(item, [index]))
  return result
}
