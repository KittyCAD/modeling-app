import { signal } from '@preact/signals-core'
import type {
  HomeProjectAction,
  HomeProjectActionsService,
  HomeProjectEntry,
} from '@src/registry/contracts/homeProjects'

/** Share card progress with actions started from menus and the command palette. */
export function withHomeProjectActionStatus(
  actions: Omit<HomeProjectActionsService, 'pendingActions'>
): HomeProjectActionsService {
  const pendingActions = signal<ReadonlyMap<string, HomeProjectAction>>(
    new Map()
  )
  const run = async <T>(
    project: HomeProjectEntry,
    action: HomeProjectAction,
    work: () => Promise<T>
  ): Promise<T> => {
    if (pendingActions.peek().has(project.id))
      return Promise.reject(
        new Error('Wait for the current project action to finish.')
      )
    pendingActions.value = new Map(pendingActions.peek()).set(
      project.id,
      action
    )
    try {
      return await work()
    } finally {
      const pending = new Map(pendingActions.peek())
      pending.delete(project.id)
      pendingActions.value = pending
    }
  }
  return {
    ...actions,
    pendingActions,
    open: (project) => run(project, 'Opening', () => actions.open(project)),
    rename: (project, name, options) =>
      run(project, 'Renaming', () => actions.rename(project, name, options)),
    delete: (project) =>
      run(project, 'Deleting', () => actions.delete(project)),
    duplicate: (project) =>
      run(project, 'Duplicating', () => actions.duplicate(project)),
    cloneToLibrary: (project, libraryId, options) =>
      run(project, 'Cloning', () =>
        actions.cloneToLibrary(project, libraryId, options)
      ),
    deleteDuplicateRealizations: (project, paths) =>
      run(project, 'Deleting', () =>
        actions.deleteDuplicateRealizations(project, paths)
      ),
    separateProjectCopies: (project, keep) =>
      run(project, 'Separating', () =>
        actions.separateProjectCopies(project, keep)
      ),
  }
}
