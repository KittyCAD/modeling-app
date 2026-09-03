import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'

/**
 * One lock in the canonical plan for a coordinated filesystem operation.
 *
 * Mutations use exclusive target locks while reads use shared target locks.
 * Ancestors are always shared so sibling paths can proceed concurrently while
 * directory-level mutations wait for work anywhere below that directory.
 */
export interface PathLockRequirement {
  readonly path: string
  readonly mode: 'shared' | 'exclusive'
}

/**
 * Builds a stable, duplicate-free lock plan for one or more mutation targets.
 */
export function pathLockRequirements(
  backing: Pick<IZooDesignStudioFS, 'dirname' | 'resolve'>,
  paths: readonly string[],
  targetMode: PathLockRequirement['mode'] = 'exclusive'
): readonly PathLockRequirement[] {
  const modesByPath = new Map<string, PathLockRequirement['mode']>()

  for (const path of paths) {
    let current = backing.resolve(path)
    const existingTargetMode = modesByPath.get(current)
    if (targetMode === 'exclusive' || existingTargetMode === undefined) {
      modesByPath.set(current, targetMode)
    }

    while (true) {
      const parent = backing.dirname(current)
      if (parent === current) {
        break
      }

      if (!modesByPath.has(parent)) {
        modesByPath.set(parent, 'shared')
      }
      current = parent
    }
  }

  return [...modesByPath]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, mode]) => ({ path, mode }))
}
