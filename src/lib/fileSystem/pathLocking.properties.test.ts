import {
  type PathLockRequirement,
  pathLockRequirements,
} from '@src/lib/fileSystem/pathLocking'
import nodeFileSystem from '@src/lib/fs-zds/nodefs'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

const segmentArbitrary = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'), {
    minLength: 1,
    maxLength: 12,
  })
  .map((characters) => characters.join(''))

const pathArbitrary = fc
  .array(segmentArbitrary, { minLength: 1, maxLength: 5 })
  .map((segments) => nodeFileSystem.impl.join('workspace', ...segments))

function requirements(paths: readonly string[]) {
  return pathLockRequirements(nodeFileSystem.impl, paths)
}

function plansConflict(
  left: readonly PathLockRequirement[],
  right: readonly PathLockRequirement[]
) {
  const leftByPath = new Map(left.map(({ path, mode }) => [path, mode]))

  return right.some(({ path, mode }) => {
    const leftMode = leftByPath.get(path)
    return (
      leftMode !== undefined &&
      (leftMode === 'exclusive' || mode === 'exclusive')
    )
  })
}

function mergePlans(
  ...plans: ReadonlyArray<readonly PathLockRequirement[]>
): readonly PathLockRequirement[] {
  const modesByPath = new Map<string, PathLockRequirement['mode']>()

  for (const requirement of plans.flat()) {
    if (
      requirement.mode === 'exclusive' ||
      !modesByPath.has(requirement.path)
    ) {
      modesByPath.set(requirement.path, requirement.mode)
    }
  }

  return [...modesByPath]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, mode]) => ({ path, mode }))
}

describe('filesystem path lock planning', () => {
  it('produces one canonical plan for any ordering of the targets', () => {
    fc.assert(
      fc.property(
        fc.array(pathArbitrary, { minLength: 1, maxLength: 8 }),
        (paths) => {
          const plan = requirements(paths)
          const targetPaths = new Set(
            paths.map((path) => nodeFileSystem.impl.resolve(path))
          )

          expect(requirements([...paths, ...paths].reverse())).toEqual(plan)
          expect(new Set(plan.map(({ path }) => path)).size).toBe(plan.length)
          expect(
            plan
              .filter(({ mode }) => mode === 'exclusive')
              .map(({ path }) => path)
          ).toEqual(
            [...targetPaths].sort((left, right) => left.localeCompare(right))
          )
        }
      )
    )
  })

  it('captures hierarchical conflicts without blocking siblings', () => {
    fc.assert(
      fc.property(pathArbitrary, pathArbitrary, (root, suffix) => {
        const target = nodeFileSystem.impl.join(root, 'target')
        const descendant = nodeFileSystem.impl.join(target, suffix)
        const sibling = nodeFileSystem.impl.join(root, 'sibling')
        const targetPlan = requirements([target])

        expect(plansConflict(targetPlan, requirements([target]))).toBe(true)
        expect(plansConflict(targetPlan, requirements([descendant]))).toBe(true)
        expect(plansConflict(targetPlan, requirements([sibling]))).toBe(false)
      })
    )
  })

  it('shares file reads while conflicting with writes and project mutations', () => {
    fc.assert(
      fc.property(pathArbitrary, pathArbitrary, (projectsRoot, suffix) => {
        const project = nodeFileSystem.impl.join(projectsRoot, 'project')
        const file = nodeFileSystem.impl.join(project, suffix, 'main.kcl')
        const sibling = nodeFileSystem.impl.join(projectsRoot, 'sibling.kcl')
        const readPlan = pathLockRequirements(
          nodeFileSystem.impl,
          [file],
          'shared'
        )

        expect(
          plansConflict(
            readPlan,
            pathLockRequirements(nodeFileSystem.impl, [file], 'shared')
          )
        ).toBe(false)
        expect(plansConflict(readPlan, requirements([file]))).toBe(true)
        expect(plansConflict(readPlan, requirements([project]))).toBe(true)
        expect(plansConflict(readPlan, requirements([sibling]))).toBe(false)
      })
    )
  })

  it('composes the lock plans for multi-path operations', () => {
    fc.assert(
      fc.property(pathArbitrary, pathArbitrary, (source, destination) => {
        expect(requirements([source, destination])).toEqual(
          mergePlans(requirements([source]), requirements([destination]))
        )
      })
    )
  })
})
