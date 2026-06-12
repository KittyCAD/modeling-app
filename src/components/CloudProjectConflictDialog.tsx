import { Dialog } from '@headlessui/react'
import { useSignals } from '@preact/signals-react/runtime'
import { diffLines } from 'diff'
import { useEffect, useMemo, useState } from 'react'

import { ActionButton } from '@src/components/ActionButton'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import {
  type OpfsCloudConflictResolution,
  type OpfsCloudProjectConflictDetail,
  type ProjectArchiveFile,
  type ProjectConflictFileChange,
  getOpfsCloudProjectConflict,
  opfsCloudSyncStatus,
  resolveOpfsCloudProjectConflict,
} from '@src/lib/fs-zds/opfsCloud'
import { reportRejection } from '@src/lib/trap'
import { toSync } from '@src/lib/utils'

type CloudProjectConflictIndicatorProps = {
  projectPath?: string
  projectName?: string
  variant?: 'card' | 'sidebar'
}

const statusLabels: Record<ProjectConflictFileChange['status'], string> = {
  'remote-changed': 'Remote changed, local unchanged',
  'local-changed': 'Local changed, remote unchanged',
  'both-changed-identically': 'Both changed identically',
  'both-changed-differently': 'Both changed differently',
  'add-delete-conflict': 'Add/delete conflict',
  'binary-conflict': 'Binary conflict',
}

function getFileMap(files: ProjectArchiveFile[]) {
  return new Map(files.map((file) => [file.relativePath, file]))
}

function decodeText(file: ProjectArchiveFile | undefined) {
  if (!file) {
    return undefined
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(file.data)
    return text.includes('\u0000') ? undefined : text
  } catch {
    return undefined
  }
}

function shortDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function CloudProjectConflictIndicator({
  projectPath,
  projectName = 'Project',
  variant = 'sidebar',
}: CloudProjectConflictIndicatorProps) {
  useSignals()
  const syncStatus = opfsCloudSyncStatus.value
  const [conflict, setConflict] =
    useState<OpfsCloudProjectConflictDetail | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!projectPath) {
      setConflict(null)
      return
    }

    getOpfsCloudProjectConflict(projectPath)
      .then((nextConflict) => {
        if (!cancelled) {
          setConflict(nextConflict ?? null)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConflict(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [
    projectPath,
    syncStatus.activeProjectPath,
    syncStatus.lastFailureAt,
    syncStatus.lastSyncedAt,
    syncStatus.state,
  ])

  if (!conflict) {
    return null
  }

  const isCard = variant === 'card'
  return (
    <>
      <ActionButton
        Element="button"
        type="button"
        className={
          isCard
            ? '!p-1 border-amber-50 bg-amber-100 text-amber-900 hover:border-amber-60 dark:bg-amber-900 dark:text-amber-100'
            : '!px-2 !py-1 border-amber-50 bg-amber-100 text-amber-900 hover:border-amber-60 dark:bg-amber-900 dark:text-amber-100'
        }
        iconStart={{
          icon: 'triangleExclamation',
          bgClassName: '!bg-transparent',
          iconClassName: '!text-current',
        }}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setDialogOpen(true)
        }}
        aria-label="Review cloud conflict"
        data-testid="cloud-conflict-indicator"
      >
        <span className={isCard ? 'sr-only' : ''}>Review cloud conflict</span>
        <Tooltip position={isCard ? 'top-right' : 'bottom-left'}>
          Review cloud conflict
        </Tooltip>
      </ActionButton>
      {dialogOpen && (
        <CloudProjectConflictDialog
          conflict={conflict}
          projectName={projectName}
          onDismiss={() => setDialogOpen(false)}
          onResolved={() => {
            setDialogOpen(false)
            setConflict(null)
          }}
        />
      )}
    </>
  )
}

function CloudProjectConflictDialog({
  conflict,
  projectName,
  onDismiss,
  onResolved,
}: {
  conflict: OpfsCloudProjectConflictDetail
  projectName: string
  onDismiss: () => void
  onResolved: () => void
}) {
  const [resolutionInProgress, setResolutionInProgress] =
    useState<OpfsCloudConflictResolution | null>(null)
  const localFiles = useMemo(
    () => getFileMap(conflict.localFiles),
    [conflict.localFiles]
  )
  const remoteFiles = useMemo(
    () => getFileMap(conflict.remoteFiles),
    [conflict.remoteFiles]
  )

  async function resolveConflict(resolution: OpfsCloudConflictResolution) {
    setResolutionInProgress(resolution)
    try {
      await resolveOpfsCloudProjectConflict(conflict.projectPath, resolution)
      onResolved()
    } catch (error) {
      reportRejection(error)
    } finally {
      setResolutionInProgress(null)
    }
  }

  return (
    <Dialog open={true} onClose={onDismiss} className="relative z-50">
      <div className="fixed inset-0 grid bg-chalkboard-110/80 p-4 place-content-center">
        <Dialog.Panel className="flex max-h-[85vh] w-[min(960px,calc(100vw-2rem))] flex-col rounded border border-amber-60 bg-chalkboard-10 p-4 shadow-lg dark:border-amber-80 dark:bg-chalkboard-100">
          <Dialog.Title
            as="h2"
            className="mb-1 flex items-center gap-2 text-xl font-bold"
          >
            <CustomIcon
              name="triangleExclamation"
              className="h-5 w-5 text-amber-700 dark:text-amber-300"
            />
            Cloud conflict
          </Dialog.Title>
          <Dialog.Description className="mb-4 text-sm text-chalkboard-70 dark:text-chalkboard-30">
            {projectName} has local edits and remote edits from revision{' '}
            {conflict.remoteRevision ?? 'unknown'}. Review the changed files,
            then choose which side should become the project state.
          </Dialog.Description>

          <div className="mb-3 flex flex-wrap gap-2 text-xs text-chalkboard-70 dark:text-chalkboard-30">
            <span>{conflict.fileChanges.length} changed paths</span>
            <span>Detected {shortDate(conflict.createdAt)}</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto border border-chalkboard-20 dark:border-chalkboard-80">
            {conflict.fileChanges.map((change) => (
              <ConflictFileChange
                key={change.relativePath}
                change={change}
                localFile={localFiles.get(change.relativePath)}
                remoteFile={remoteFiles.get(change.relativePath)}
              />
            ))}
          </div>

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <ActionButton Element="button" onClick={onDismiss}>
              Cancel
            </ActionButton>
            <ActionButton
              Element="button"
              iconStart={{
                icon: 'download',
                bgClassName: '!bg-transparent',
              }}
              disabled={resolutionInProgress !== null}
              onClick={toSync(
                () => resolveConflict('accept-remote'),
                reportRejection
              )}
            >
              {resolutionInProgress === 'accept-remote'
                ? 'Accepting...'
                : 'Accept remote'}
            </ActionButton>
            <ActionButton
              Element="button"
              iconStart={{
                icon: 'file',
                bgClassName: '!bg-transparent',
              }}
              disabled={resolutionInProgress !== null}
              onClick={toSync(
                () => resolveConflict('keep-local'),
                reportRejection
              )}
            >
              {resolutionInProgress === 'keep-local'
                ? 'Keeping...'
                : 'Keep local'}
            </ActionButton>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  )
}

function ConflictFileChange({
  change,
  localFile,
  remoteFile,
}: {
  change: ProjectConflictFileChange
  localFile?: ProjectArchiveFile
  remoteFile?: ProjectArchiveFile
}) {
  const localText = decodeText(localFile)
  const remoteText = decodeText(remoteFile)
  const canShowDiff = localText !== undefined && remoteText !== undefined
  const diff = canShowDiff ? diffLines(localText, remoteText) : []

  return (
    <section className="border-b border-chalkboard-20 last:border-b-0 dark:border-chalkboard-80">
      <header className="flex flex-wrap items-center gap-2 bg-chalkboard-20 px-3 py-2 text-sm dark:bg-chalkboard-90">
        <span className="font-mono">{change.relativePath}</span>
        <span className="rounded-sm bg-chalkboard-10 px-1.5 py-0.5 text-xs text-chalkboard-70 dark:bg-chalkboard-100 dark:text-chalkboard-30">
          {statusLabels[change.status]}
        </span>
      </header>
      <div className="max-h-64 overflow-auto bg-chalkboard-10 p-3 font-mono text-xs leading-5 dark:bg-chalkboard-100">
        {canShowDiff ? (
          diff.map((part, index) => (
            <pre
              key={`${change.relativePath}-${index}`}
              className={
                part.added
                  ? 'bg-success-10 text-success-80 dark:bg-success-80/20 dark:text-success-20'
                  : part.removed
                    ? 'bg-destroy-10 text-destroy-80 dark:bg-destroy-80/20 dark:text-destroy-20'
                    : 'text-chalkboard-80 dark:text-chalkboard-20'
              }
            >
              {part.value}
            </pre>
          ))
        ) : (
          <p className="text-chalkboard-70 dark:text-chalkboard-30">
            Text diff unavailable. Choose local or remote for this project-wide
            conflict.
          </p>
        )}
      </div>
    </section>
  )
}
