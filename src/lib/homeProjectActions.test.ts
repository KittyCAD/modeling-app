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
  {
    label: 'Opening',
    method: 'open',
    args: [project],
    start: (actions: HomeProjectActionsService) => actions.open(project),
  },
  {
    label: 'Renaming',
    method: 'rename',
    args: [project, 'New title', { notify: false }],
    start: (actions: HomeProjectActionsService) =>
      actions.rename(project, 'New title', { notify: false }),
  },
  {
    label: 'Deleting',
    method: 'delete',
    args: [project],
    start: (actions: HomeProjectActionsService) => actions.delete(project),
  },
  {
    label: 'Duplicating',
    method: 'duplicate',
    args: [project],
    start: (actions: HomeProjectActionsService) => actions.duplicate(project),
  },
  {
    label: 'Cloning',
    method: 'cloneToLibrary',
    args: [project, 'library', { title: 'Copy' }],
    start: (actions: HomeProjectActionsService) =>
      actions.cloneToLibrary(project, 'library', { title: 'Copy' }),
  },
  {
    label: 'Deleting',
    method: 'deleteDuplicateRealizations',
    args: [project, ['/copy']],
    start: (actions: HomeProjectActionsService) =>
      actions.deleteDuplicateRealizations(project, ['/copy']),
  },
  {
    label: 'Separating',
    method: 'separateProjectCopies',
    args: [project, '/keep'],
    start: (actions: HomeProjectActionsService) =>
      actions.separateProjectCopies(project, '/keep'),
  },
] as const

describe('Home project action progress', () => {
  it.each(cases)(
    'runs $method with its arguments, keeps $label visible during slow I/O, and releases after failure',
    async ({ label, method, args, start }) => {
      vi.useFakeTimers()
      const gate = Promise.withResolvers<undefined>()
      const work = vi.fn(() => gate.promise)
      const underlying = {
        watchRemoteThumbnail: () => undefined,
        canOpen: () => true,
        canRename: () => true,
        canDelete: () => true,
        canDuplicate: () => true,
        canCloneToLibrary: () => true,
        canReviewDuplicateRealizations: () => true,
        canSeparateProjectCopies: () => true,
        getCloneToLibraryTargets: () => [],
        open: vi.fn(() => work()),
        rename: vi.fn(() => work()),
        delete: vi.fn(() => work()),
        duplicate: vi.fn(() => work()),
        cloneToLibrary: vi.fn(() => work()),
        deleteDuplicateRealizations: vi.fn(() => work()),
        separateProjectCopies: vi.fn(() => work()),
      }
      const actions = withHomeProjectActionStatus(underlying)
      const pending = start(actions)
      const failed = expect(pending).rejects.toThrow('Disconnected')
      try {
        expect(underlying[method]).toHaveBeenCalledWith(...args)
        for (const other of cases.map((entry) => entry.method)) {
          if (other !== method) expect(underlying[other]).not.toHaveBeenCalled()
        }
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
