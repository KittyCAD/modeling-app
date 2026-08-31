import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed, effect } from '@preact/signals'
import { commandsValueSpec } from '@src/contracts/commands'
import {
  changeHistoryService,
  projectHistoryService,
} from '@src/contracts/projectHistory'
import { projectSessionService } from '@src/contracts/projectSession'
import { createProjectActionHistory } from '@src/features/projectHistory/createProjectActionHistory'
import { createChangeHistory } from '@src/lib/collab/changeHistory'

/**
 * Coordinated undo for the project (#13353).
 *
 * Owns the shared applied-change log and the labelled action stack over it.
 * Neither belongs to any one writer: the agent, the modelling operations and
 * `applyMutation` all record into the same log, because undoing any one of them
 * means projecting its inverse through everything the *others* did afterwards.
 *
 * The log is created here rather than by whoever writes first, so nobody ends up
 * holding a partial one.
 */
export default defineRegistryItemFactory((ctx) => {
  const changeHistory = createChangeHistory()

  // Lazy, and never resolved in this body: reading a service during graph
  // construction is not allowed.
  const sessions = () => ctx.services.get(projectSessionService)

  const history = createProjectActionHistory({
    changeHistory,
    bufferForPath: (path) => sessions().current.peek()?.bufferForPath(path),
  })

  /**
   * Follow every open buffer, here rather than in each writer.
   *
   * History cannot be recorded retroactively — by the time an action is recorded
   * its changes have already been dispatched — so following has to be in place
   * *before* anybody writes. Leaving that to each writer means the one that
   * forgets produces actions that silently cannot be undone, so the feature that
   * owns the log owns the subscription too.
   *
   * `follow` replaces a path's subscription rather than adding one, and keeps the
   * entries already recorded, so re-running this as buffers open and close is
   * safe and no change is ever logged twice.
   *
   * Keyed by path, which is the known limit: a renamed buffer starts a fresh log
   * under its new name and actions older than the rename stop being undoable.
   * Honest, and the alternative — keying by buffer id — loses history across a
   * close and reopen instead, which happens far more often.
   */
  let stopFollowing: (() => void) | null = null
  let disposed = false
  queueMicrotask(() => {
    if (disposed) return
    stopFollowing = effect(() => {
      const session = sessions().current.value
      if (session === null) return
      for (const buffer of session.buffers.value) {
        const path = session.relativePathFor(buffer)
        if (path !== null) changeHistory.follow(path, buffer)
      }
    })
  })

  return {
    item: defineRuntimeRegistryItem({
      id: 'projectHistory',
      dispose: () => {
        disposed = true
        stopFollowing?.()
        changeHistory.dispose()
      },
      providesServices: [
        provideService(changeHistoryService, changeHistory),
        provideService(projectHistoryService, history),
      ],
      provides: [
        provide(commandsValueSpec, {
          id: 'project.undoAction',
          /*
           * Named for what it undoes rather than "Undo", so it cannot be mistaken
           * for the editing chord. Ctrl-Z still belongs to whoever is typing; this
           * is the coordinated one, and the label has to say so.
           */
          title: 'Undo last project action',
          category: 'Edit',
          icon: 'arrowRotateLeft',
          enabled: computed(() => history.undoable.value !== null),
          run: () => {
            const action = history.undoable.peek()
            if (action === null) return
            history.revert(action.id)
          },
        }),
      ],
    }),
  }
}, 'projectHistory')
