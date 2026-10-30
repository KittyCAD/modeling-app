import { useSignals } from '@preact/signals-react/runtime'
import type { AppHeaderItemProps } from '@src/registry/contracts/appHeader'
import { cloudStorageService } from '@src/registry/contracts/fileOperations'
import { reportRejection } from '@src/lib/trap'

export function CloudSaveStatus({ app, className }: AppHeaderItemProps) {
  useSignals()
  const cloud = app.registry.get(cloudStorageService)
  const path = app.projectSignal.value?.path
  if (!path || !path.startsWith(cloud.root)) return null
  const id = cloud.idFor(path)
  const status = cloud.saves.value.get(id)
  if (!status || status.state === 'saved') return null
  return (
    <span role="status" className={className}>
      {status.state === 'saving' ? (
        'Saving...'
      ) : (
        <button
          type="button"
          onClick={() => {
            void cloud.retry(id).catch(reportRejection)
          }}
        >
          Save failed. Retry
        </button>
      )}
    </span>
  )
}
