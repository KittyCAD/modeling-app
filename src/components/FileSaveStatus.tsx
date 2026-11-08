import { useSignals } from '@preact/signals-react/runtime'
import type { AppHeaderItemProps } from '@src/registry/contracts/appHeader'
import { cloudStorageService } from '@src/registry/contracts/fileOperations'
import { reportRejection } from '@src/lib/trap'
import { useIsOffline } from '@src/hooks/network/useIsOffline'

export function FileSaveStatus({ app, className }: AppHeaderItemProps) {
  useSignals()
  const offline = useIsOffline()
  const cloud = app.registry.get(cloudStorageService)
  const path = app.projectSignal.value?.path
  if (!path) return null
  const editor = app.projectSignal.value?.executingEditor.value
  const isCloud = path.startsWith(cloud.root)
  const id = isCloud ? cloud.idFor(path) : undefined
  const status = id
    ? cloud.saves.value.get(id)
    : editor
      ? { state: editor.saveState.value }
      : undefined
  const retry = async () => {
    if (!id) {
      await editor?.flushWriteToFile()
      return
    }
    const requestedPath = editor?.path
    await cloud.retry(id)
    if (
      !editor ||
      app.projectSignal.peek()?.executingEditor.peek() !== editor ||
      editor.path !== requestedPath
    )
      return
    const contents = await editor.textFileIO.read(requestedPath)
    if (
      cloud.saves.peek().get(id)?.state === 'saved' &&
      editor.code === contents
    )
      editor.synchronizeCurrentEditorAfterDirectGlobalReplay({
        filePath: requestedPath,
        nextContent: contents,
        shouldSyncRust: false,
      })
  }
  if (isCloud && offline)
    return (
      <span role="status" className={className}>
        Offline. Cloud project is read-only.
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
            void retry().catch(reportRejection)
          }}
        >
          Save failed. Retry
        </button>
      )}
    </span>
  )
}
