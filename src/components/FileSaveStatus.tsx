import { useSignals } from '@preact/signals-react/runtime'
import type { AppHeaderItemProps } from '@src/registry/contracts/appHeader'

import { reportRejection, trap } from '@src/lib/trap'

export function FileSaveStatus({ app, className }: AppHeaderItemProps) {
  useSignals()
  const path = app.projectSignal.value?.path
  if (!path) return null
  const editor = app.projectSignal.value?.executingEditor.value
  const storage = app.projectSession.storageFor(path)
  const availability = storage.writeAvailability.value
  const status =
    storage.saveState?.value ??
    (editor ? { state: editor.saveState.value } : undefined)
  if (!availability.writable)
    return (
      <span role="status" className={className}>
        {availability.reason}
      </span>
    )
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
