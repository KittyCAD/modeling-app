import { Dialog } from '@headlessui/react'
import { useSignals } from '@preact/signals-react/runtime'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'

import { ActionButton } from '@src/components/ActionButton'
import {
  type OpfsCloudConflictResolution,
  type ProjectMetadata,
  getOpfsCloudProjectMetadata,
  getOpfsCloudProjectMetadataIndex,
  opfsCloudSyncStatus,
  resolveOpfsCloudProjectConflict,
} from '@src/lib/fs-zds/opfsCloud'
import { reportRejection } from '@src/lib/trap'

type CloudConflictDialogProps = {
  projectPath: string
  projectName: string
  onDismiss: () => void
  onResolved?: () => void
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function useOpfsCloudProjectConflict(projectPath?: string) {
  useSignals()
  const status = opfsCloudSyncStatus.value
  const [metadata, setMetadata] = useState<ProjectMetadata | undefined>()

  useEffect(() => {
    let cancelled = false

    if (!status.enabled || !projectPath) {
      setMetadata(undefined)
      return
    }

    getOpfsCloudProjectMetadata(projectPath)
      .then((nextMetadata) => {
        if (!cancelled) {
          setMetadata(nextMetadata?.conflict ? nextMetadata : undefined)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMetadata(undefined)
        }
        reportRejection(error)
      })

    return () => {
      cancelled = true
    }
  }, [
    projectPath,
    status.enabled,
    status.state,
    status.pendingCount,
    status.lastFailureAt,
    status.lastSyncedAt,
  ])

  return metadata
}

export function useOpfsCloudProjectConflicts() {
  useSignals()
  const status = opfsCloudSyncStatus.value
  const [metadata, setMetadata] = useState<ProjectMetadata[] | undefined>()

  useEffect(() => {
    let cancelled = false

    if (!status.enabled) {
      setMetadata([])
      return
    }

    setMetadata(undefined)
    getOpfsCloudProjectMetadataIndex()
      .then((metadataIndex) => {
        if (cancelled) {
          return
        }

        setMetadata(
          Array.from(metadataIndex.values())
            .filter((entry) => entry.conflict)
            .toSorted((left, right) =>
              left.projectName.localeCompare(right.projectName)
            )
        )
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMetadata([])
        }
        reportRejection(error)
      })

    return () => {
      cancelled = true
    }
  }, [
    status.enabled,
    status.state,
    status.pendingCount,
    status.lastFailureAt,
    status.lastSyncedAt,
  ])

  return metadata
}

export function CloudConflictDialog({
  projectPath,
  projectName,
  onDismiss,
  onResolved,
}: CloudConflictDialogProps) {
  const [resolving, setResolving] =
    useState<OpfsCloudConflictResolution | null>(null)

  async function resolveConflict(resolution: OpfsCloudConflictResolution) {
    setResolving(resolution)
    try {
      await resolveOpfsCloudProjectConflict(projectPath, resolution)
      toast.success('Cloud conflict resolved.')
      onResolved?.()
      onDismiss()
    } catch (error) {
      toast.error(messageFromError(error))
      reportRejection(error)
    } finally {
      setResolving(null)
    }
  }

  return (
    <Dialog open={true} onClose={onDismiss} className="relative z-50">
      <div className="fixed inset-0 grid bg-chalkboard-110/80 place-content-center p-4">
        <Dialog.Panel
          className="w-full max-w-xl rounded border border-warn-80 bg-chalkboard-10 p-4 shadow-lg dark:bg-chalkboard-100"
          data-testid="cloud-conflict-dialog"
        >
          <Dialog.Title as="h2" className="mb-1 text-2xl font-bold">
            Cloud conflict
          </Dialog.Title>
          <p className="mb-4 break-words text-sm font-medium text-chalkboard-80 dark:text-chalkboard-30">
            {projectName}
          </p>
          <Dialog.Description as="div" className="space-y-3 text-sm">
            <p className="break-words">
              Local and cloud data both changed for "{projectName}". Choose
              which version should become the project source of truth.
            </p>
            <p>
              Using local data uploads your current local project to the cloud.
              Using cloud data replaces the local project with the conflicted
              cloud version that was saved locally.
            </p>
          </Dialog.Description>

          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <ActionButton
              Element="button"
              onClick={onDismiss}
              disabled={resolving !== null}
              tabIndex={0}
            >
              Cancel
            </ActionButton>
            <ActionButton
              Element="button"
              data-testid="use-cloud-data"
              disabled={resolving !== null}
              tabIndex={0}
              onClick={() => void resolveConflict('cloud')}
            >
              {resolving === 'cloud' ? 'Using cloud data...' : 'Use cloud data'}
            </ActionButton>
            <ActionButton
              Element="button"
              data-testid="use-local-data"
              disabled={resolving !== null}
              tabIndex={0}
              onClick={() => void resolveConflict('local')}
              className="border-warn-70 bg-warn-10/30 dark:bg-warn-80/20"
            >
              {resolving === 'local' ? 'Using local data...' : 'Use local data'}
            </ActionButton>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  )
}
