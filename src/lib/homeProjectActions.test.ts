import { withHomeProjectActionStatus } from '@src/lib/homeProjectActions'
import type {
  HomeProjectActionsService,
  HomeProjectEntry,
} from '@src/registry/contracts/homeProjects'
import { describe, expect, it, vi } from 'vitest'

const project: HomeProjectEntry = {
  id: 'project',
  name: 'Project',
  source: 'remote',
  status: 'cloud-only',
  readWriteAccess: true,
}

const cases = [
  ['Opening', (actions: HomeProjectActionsService) => actions.open(project)],
  [
    'Renaming',
    (actions: HomeProjectActionsService) =>
      actions.rename(project, 'New title'),
  ],
  ['Deleting', (actions: HomeProjectActionsService) => actions.delete(project)],
  [
    'Duplicating',
    (actions: HomeProjectActionsService) => actions.duplicate(project),
  ],
  [
    'Cloning',
    (actions: HomeProjectActionsService) =>
      actions.cloneToLibrary(project, 'library'),
  ],
  [
    'Deleting',
    (actions: HomeProjectActionsService) =>
      actions.deleteDuplicateRealizations(project, ['/copy']),
  ],
  [
    'Separating',
    (actions: HomeProjectActionsService) =>
      actions.separateProjectCopies(project),
  ],
] as const

describe('Home project action progress', () => {
  it.each(cases)(
    'keeps %s visible during slow I/O, rejects competing actions, and releases after failure',
    async (label, start) => {
      vi.useFakeTimers()
      const gate = Promise.withResolvers<undefined>()
      const work = vi.fn(() => gate.promise)
      const actions = withHomeProjectActionStatus({
        watchRemoteThumbnail: () => undefined,
        canOpen: () => true,
        canRename: () => true,
        canDelete: () => true,
        canDuplicate: () => true,
        canCloneToLibrary: () => true,
        canReviewDuplicateRealizations: () => true,
        canSeparateProjectCopies: () => true,
        getCloneToLibraryTargets: () => [],
        open: work,
        rename: work,
        delete: work,
        duplicate: work,
        cloneToLibrary: work,
        deleteDuplicateRealizations: work,
        separateProjectCopies: work,
      })
      const pending = start(actions)
      const failed = expect(pending).rejects.toThrow('Disconnected')
      try {
        expect(actions.pendingActions.value.get(project.id)).toBe(label)
        await expect(actions.delete(project)).rejects.toThrow(
          'Wait for the current project action'
        )
        expect(work).toHaveBeenCalledOnce()
        await vi.advanceTimersByTimeAsync(7_000)
        expect(actions.pendingActions.value.get(project.id)).toBe(label)
        // Independent cards remain usable and finishing one cannot clear another.
        work.mockResolvedValueOnce(undefined)
        await actions.open({ ...project, id: 'another-project' })
        expect(actions.pendingActions.value.size).toBe(1)
        expect(actions.pendingActions.value.get(project.id)).toBe(label)
        gate.reject(new Error('Disconnected'))
        await failed
        expect(actions.pendingActions.value.size).toBe(0)
        work.mockResolvedValueOnce(undefined)
        await actions.open(project)
        expect(actions.pendingActions.value.size).toBe(0)
      } finally {
        gate.resolve(undefined)
        await Promise.allSettled([pending, failed])
        vi.useRealTimers()
      }
    }
  )
})
