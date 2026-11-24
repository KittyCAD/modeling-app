import type { ReadonlySignal } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import type { KclManager } from '@src/lang/KclManager'
import type { ProjectStorage } from '@src/lib/projectSession/storage'
import { reportRejection, trap } from '@src/lib/trap'
import type { ProjectSessionService } from '@src/registry/contracts/projectSession'
import type { ReactNode } from 'react'

interface FileSaveStatusProps {
  project: ReadonlySignal<
    | {
        readonly path: string
        readonly executingEditor: ReadonlySignal<
          | Pick<
              KclManager,
              'saveState' | 'codeSignal' | 'hasUnsavedLocalChanges'
            >
          | null
          | undefined
        >
      }
    | undefined
  >
  storageFor: (
    path: string
  ) => Pick<ProjectStorage, 'saveState' | 'writeAvailability'>
  retrySave: ProjectSessionService['retrySave']
  readOnlyAction?: ReactNode
}

export function FileSaveStatus({
  project,
  storageFor,
  retrySave,
  readOnlyAction,
}: FileSaveStatusProps) {
  useSignals()
  const path = project.value?.path
  if (!path) return null
  const editor = project.value?.executingEditor.value
  const storage = storageFor(path)
  const availability = storage.writeAvailability.value
  const status =
    storage.saveState?.value ??
    (editor ? { state: editor.saveState.value } : undefined)
  const editorCode = editor?.codeSignal.value
  const unsaved =
    (editorCode !== undefined && editor?.hasUnsavedLocalChanges()) ||
    (status !== undefined && status.state !== 'saved')
  let message: ReactNode
  if (!availability.writable) {
    message = (
      <>
        {availability.reason}
        {readOnlyAction}
      </>
    )
  } else if (status?.state === 'saving') {
    message = 'Saving...'
  } else if (status?.state === 'failed') {
    message = (
      <button
        type="button"
        className="rounded-sm hover:underline focus-visible:outline-appForeground"
        onClick={() => {
          void retrySave().then(trap).catch(reportRejection)
        }}
      >
        Save failed. Retry
      </button>
    )
  }
  if (!message && !unsaved) return null
  return (
    <span
      role="status"
      className="inline-flex shrink-0 self-center items-center gap-1.5 text-xs text-2"
    >
      {unsaved && (
        <span
          role="img"
          aria-label="Unsaved changes"
          title="Unsaved changes"
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-current"
        />
      )}
      {message}
    </span>
  )
}
