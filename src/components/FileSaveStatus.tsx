import { useSignals } from '@preact/signals-react/runtime'
import { useApp } from '@src/lib/boot'
import { defaultStatusBarItemClassNames } from '@src/components/StatusBar/StatusBar'

import { reportRejection, trap } from '@src/lib/trap'
import { selectCommand } from '@src/lib/commandUtils'
import { findHomeProjectByPath } from '@src/lib/homeProjects'
import {
  homeProjectActionsService,
  homeProjectEntriesFacet,
} from '@src/registry/contracts/homeProjects'

export function FileSaveStatus() {
  useSignals()
  const app = useApp()
  const className = defaultStatusBarItemClassNames
  const path = app.projectSignal.value?.path
  if (!path) return null
  const editor = app.projectSignal.value?.executingEditor.value
  const storage = app.projectSession.storageFor(path)
  const availability = storage.writeAvailability.value
  const status =
    storage.saveState?.value ??
    (editor ? { state: editor.saveState.value } : undefined)
  if (!availability.writable) {
    const project = findHomeProjectByPath(
      app.registry.observe(homeProjectEntriesFacet).value,
      path
    )
    const canCopy =
      project &&
      !project.readWriteAccess &&
      app.registry
        .optional(homeProjectActionsService)
        ?.canCloneToLibrary(project)
    return (
      <span role="status" className={className}>
        {availability.reason}
        {canCopy && (
          <button
            type="button"
            onClick={() =>
              selectCommand(app.commands, {
                groupId: 'projects',
                name: 'Clone project',
                argDefaultValues: { project: project.id },
              })
            }
          >
            Create an editable copy
          </button>
        )}
      </span>
    )
  }
  if (!status || status.state === 'saved') return null
  return (
    <span role="status" className={className}>
      {status.state === 'saving' ? (
        'Saving...'
      ) : (
        <button
          type="button"
          onClick={() => {
            void app.projectSession
              .retrySave()
              .then(trap)
              .catch(reportRejection)
          }}
        >
          Save failed. Retry
        </button>
      )}
    </span>
  )
}
