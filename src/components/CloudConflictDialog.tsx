import { Dialog } from '@headlessui/react'
import { signal } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import { ActionButton } from '@src/components/ActionButton'
import {
  type CodeDiffLanguage,
  CodeDiffView,
} from '@src/components/CodeDiffView'
import { CustomIcon } from '@src/components/CustomIcon'
import {
  type CloudSyncConflictResolution,
  type CloudSyncProjectMetadata,
  type CloudSyncProjectMetadataIndexEntry,
  cloudSyncStatus,
  getCloudSyncProjectMetadataIndex,
  isCloudSyncConflictRevisionChangedError,
  loadCloudSyncProjectConflictInspection,
  retryCloudSync,
  resolveCloudSyncProjectConflict,
} from '@src/lib/cloudSync'
import { normalizePathForSync } from '@src/lib/cloudSync/paths'
import {
  type ConflictFileComparison,
  type ConflictFileStatus,
  type ConflictInspection,
} from '@src/lib/cloudSync/conflictInspection'
import { formatDateTime, formatOptionalDateTime } from '@src/lib/dateTime'
import fsZds from '@src/lib/fs-zds'
import type { ResolvedTheme } from '@src/lib/theme'
import { reportRejection } from '@src/lib/trap'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'

type CloudConflictDialogProps = {
  projectPath: string
  projectName?: string
  resolvedTheme: ResolvedTheme
  onDismiss: () => void
  onResolved?: () => void
}

type CloudConflictDialogRequest = {
  projectPath: string
  projectName?: string
}

type CloudSyncErrorDialogRequest = {
  title: string
  message: string
  projectName?: string
  occurredAt?: string
}

type ConflictInspectionState =
  | { status: 'loading' }
  | { status: 'ready'; inspection: ConflictInspection }
  | { status: 'error'; message: string }

const cloudConflictDialogRequest = signal<CloudConflictDialogRequest | null>(
  null
)
const cloudSyncErrorDialogRequest = signal<CloudSyncErrorDialogRequest | null>(
  null
)

export function openCloudConflictDialog(request: CloudConflictDialogRequest) {
  cloudConflictDialogRequest.value = request
}

export function openCloudSyncErrorDialog(request: CloudSyncErrorDialogRequest) {
  cloudSyncErrorDialogRequest.value = request
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function conflictStatusLabel(status: ConflictFileStatus) {
  if (status === 'local-only') {
    return 'Only local'
  }
  if (status === 'cloud-only') {
    return 'Only cloud'
  }
  return 'Changed'
}

function statusBadgeClassName(status: ConflictFileStatus) {
  if (status === 'local-only') {
    return 'bg-fern-10 text-fern-100 ring-1 ring-inset ring-fern-60/40 dark:bg-fern-90/40 dark:text-fern-20 dark:ring-fern-50/50'
  }
  if (status === 'cloud-only') {
    return 'bg-river-10 text-river-100 ring-1 ring-inset ring-river-60/40 dark:bg-river-90/45 dark:text-river-20 dark:ring-river-50/50'
  }
  return 'bg-berry-10 text-berry-100 ring-1 ring-inset ring-berry-60/40 dark:bg-berry-90/45 dark:text-berry-20 dark:ring-berry-50/50'
}

function canShowDiff(file: ConflictFileComparison) {
  return !file.textUnavailableReason
}

function diffLanguage(relativePath: string): CodeDiffLanguage {
  const extension = fsZds.extname(relativePath).toLowerCase()
  if (extension === '.kcl') {
    return 'kcl'
  }
  if (extension === '.md' || extension === '.markdown') {
    return 'markdown'
  }
  return 'plain'
}

function ConflictDiffLabel({ side }: { side: 'local' | 'cloud' }) {
  const isLocal = side === 'local'
  const icon = isLocal ? 'folder' : 'cloud'
  const label = isLocal ? 'Local' : 'Cloud'
  const className = isLocal
    ? 'text-fern-100 dark:text-fern-20'
    : 'text-river-100 dark:text-river-20'

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <CustomIcon name={icon} className="h-4 w-4" />
      {label}
    </span>
  )
}

function ChangedFilesList({
  files,
  resolvedTheme,
}: {
  files: ConflictFileComparison[]
  resolvedTheme: ResolvedTheme
}) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set(files.filter(canShowDiff).map((file) => file.relativePath))
  )

  useEffect(() => {
    setExpandedPaths(
      new Set(files.filter(canShowDiff).map((file) => file.relativePath))
    )
  }, [files])

  if (files.length === 0) {
    return (
      <p className="rounded border border-chalkboard-20 bg-chalkboard-20/40 px-3 py-2 text-sm dark:border-chalkboard-70 dark:bg-chalkboard-90">
        No file content differences were found between the local project and the
        saved cloud copy.
      </p>
    )
  }

  function toggleExpanded(relativePath: string) {
    setExpandedPaths((currentPaths) => {
      const nextPaths = new Set(currentPaths)
      if (nextPaths.has(relativePath)) {
        nextPaths.delete(relativePath)
      } else {
        nextPaths.add(relativePath)
      }
      return nextPaths
    })
  }

  return (
    <div className="max-w-full space-y-3 text-xs">
      <div className="space-y-3">
        {files.map((file) => {
          const showDiff = canShowDiff(file)
          const expanded = expandedPaths.has(file.relativePath)
          const diffId = `cloud-conflict-diff-${file.relativePath.replace(
            /[^a-zA-Z0-9_-]/g,
            '-'
          )}`

          return (
            <section
              key={file.relativePath}
              className="overflow-hidden rounded bg-chalkboard-20/35 dark:bg-chalkboard-90/45"
            >
              <button
                type="button"
                aria-controls={diffId}
                aria-expanded={expanded}
                onClick={() => toggleExpanded(file.relativePath)}
                className="m-0 flex w-full items-center gap-3 border-none bg-transparent px-3 py-3 text-left hover:bg-chalkboard-20/70 focus:bg-chalkboard-20/70 focus:outline-none focus:ring-0 dark:hover:bg-chalkboard-80/60 dark:focus:bg-chalkboard-80/60"
                data-testid={`cloud-conflict-file-toggle-${file.relativePath}`}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-chalkboard-20 text-chalkboard-70 dark:bg-chalkboard-80 dark:text-chalkboard-20">
                  <CustomIcon
                    name="caretDown"
                    className={`h-4 w-4 transition-transform ${
                      expanded ? '' : '-rotate-90'
                    }`}
                  />
                </span>
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-[0.8rem] text-chalkboard-100 dark:text-chalkboard-10"
                    title={file.relativePath}
                  >
                    {file.relativePath}
                  </span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 font-medium ${statusBadgeClassName(
                      file.status
                    )}`}
                  >
                    {conflictStatusLabel(file.status)}
                  </span>
                </span>
              </button>
              {expanded && (
                <div
                  id={diffId}
                  className="bg-transparent dark:bg-transparent p-3"
                >
                  {showDiff ? (
                    <CodeDiffView
                      beforeText={file.localText ?? ''}
                      afterText={file.cloudText ?? ''}
                      beforeLabel={<ConflictDiffLabel side="local" />}
                      afterLabel={<ConflictDiffLabel side="cloud" />}
                      language={diffLanguage(file.relativePath)}
                      resolvedTheme={resolvedTheme}
                      vividChanges
                    />
                  ) : (
                    <p className="rounded bg-chalkboard-20/60 px-3 py-2 text-sm text-chalkboard-70 dark:bg-chalkboard-80/60 dark:text-chalkboard-30">
                      Diff unavailable: {file.textUnavailableReason}
                    </p>
                  )}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

export function useCloudSyncProjectMetadata(projectPath?: string) {
  useSignals()
  const status = cloudSyncStatus.value
  const [metadata, setMetadata] = useState<
    CloudSyncProjectMetadataIndexEntry | undefined
  >()

  // biome-ignore lint/correctness/useExhaustiveDependencies: cloud sync status changes intentionally refresh durable project metadata.
  useEffect(() => {
    let cancelled = false

    if (!status.enabled || !projectPath) {
      setMetadata(undefined)
      return
    }

    getCloudSyncProjectMetadataIndex()
      .then((metadataIndex) => {
        if (!cancelled) {
          setMetadata(metadataIndex.get(normalizePathForSync(projectPath)))
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

export function useCloudSyncProjectConflict(projectPath?: string) {
  const metadata = useCloudSyncProjectMetadata(projectPath)
  return metadata?.conflict ? metadata : undefined
}

export function useCloudSyncProjectConflicts() {
  useSignals()
  const status = cloudSyncStatus.value
  const [metadata, setMetadata] = useState<
    CloudSyncProjectMetadata[] | undefined
  >()

  // biome-ignore lint/correctness/useExhaustiveDependencies: cloud sync status changes intentionally refresh the conflict list.
  useEffect(() => {
    let cancelled = false

    if (!status.enabled) {
      setMetadata([])
      return
    }

    setMetadata(undefined)
    getCloudSyncProjectMetadataIndex()
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
  resolvedTheme,
  onDismiss,
  onResolved,
}: CloudConflictDialogProps) {
  const [resolving, setResolving] =
    useState<CloudSyncConflictResolution | null>(null)
  const [inspectionState, setInspectionState] =
    useState<ConflictInspectionState>({ status: 'loading' })
  const [inspectionReloadKey, setInspectionReloadKey] = useState(0)
  const inspection =
    inspectionState.status === 'ready' ? inspectionState.inspection : undefined
  const displayProjectName = inspection
    ? inspection.projectTitle || projectName
    : undefined
  const projectNameCopy = displayProjectName
    ? `"${displayProjectName}"`
    : 'this project'
  const cloudIdSuffix = inspection?.remoteProjectId
    ? `cloud ID: ${inspection.remoteProjectId}`
    : ''

  // biome-ignore lint/correctness/useExhaustiveDependencies: inspectionReloadKey intentionally forces a fresh cloud snapshot after stale resolution attempts.
  useEffect(() => {
    let cancelled = false
    setInspectionState({ status: 'loading' })

    loadCloudSyncProjectConflictInspection(projectPath)
      .then((inspection) => {
        if (cancelled) {
          return
        }

        if (inspection instanceof Error) {
          setInspectionState({
            status: 'error',
            message: messageFromError(inspection),
          })
          return
        }

        setInspectionState({ status: 'ready', inspection })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setInspectionState({
            status: 'error',
            message: messageFromError(error),
          })
        }
        reportRejection(error)
      })

    return () => {
      cancelled = true
    }
  }, [projectPath, inspectionReloadKey])

  async function resolveConflict(resolution: CloudSyncConflictResolution) {
    setResolving(resolution)
    try {
      await resolveCloudSyncProjectConflict(
        projectPath,
        resolution,
        inspection?.remoteRevision
      )
      toast.success('Cloud conflict resolved.')
      onResolved?.()
      onDismiss()
    } catch (error) {
      if (isCloudSyncConflictRevisionChangedError(error)) {
        toast.error(
          'Cloud project changed. Review the latest cloud version before resolving.'
        )
        setInspectionReloadKey((key) => key + 1)
        return
      }
      toast.error(messageFromError(error))
      reportRejection(error)
    } finally {
      setResolving(null)
    }
  }

  return (
    <Dialog
      open={true}
      onClose={onDismiss}
      className="fixed inset-0 z-50 overflow-y-auto p-4"
    >
      <Dialog.Overlay className="fixed inset-0 bg-chalkboard-10/80 dark:bg-chalkboard-110/40" />
      <div className="relative flex min-h-full items-center justify-center">
        <Dialog.Panel
          className="relative flex h-[min(90vh,56rem)] w-[min(96vw,82rem)] flex-col rounded border border-chalkboard-30 bg-chalkboard-10 shadow-lg dark:border-chalkboard-70 dark:bg-chalkboard-100"
          data-testid="cloud-conflict-dialog"
        >
          <div className="flex items-baseline justify-between gap-4 border-b border-chalkboard-20 p-4 dark:border-chalkboard-70">
            <div className="min-w-0 flex-1">
              <Dialog.Title as="h2" className="text-2xl font-bold">
                Resolve conflicts to resume cloud sync
              </Dialog.Title>
            </div>
            <span className="text-3 text-sm min-w-0">{cloudIdSuffix}</span>
            <button
              type="button"
              onClick={onDismiss}
              disabled={resolving !== null}
              className="m-0 border-none p-0 bg-destroy-10/20 hover:bg-destroy-10 focus:bg-destroy-10 focus:outline-none focus:ring-0 disabled:opacity-50 dark:bg-destroy-80/20 dark:hover:bg-destroy-80/50 dark:focus:bg-destroy-80/50"
              data-testid="cloud-conflict-close-button"
            >
              <CustomIcon name="close" className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-auto p-4">
            <Dialog.Description
              as="div"
              className="space-y-2 text-sm max-w-3xl mb-4"
            >
              <p className="break-words">
                Local and cloud data both changed for {projectNameCopy}. Review
                the saved versions, then choose which version should become the
                project source of truth.
              </p>
              <p>
                Using local data uploads your current local project to the
                cloud. Using cloud data replaces the local project with the
                cloud version shown here.
              </p>
            </Dialog.Description>

            {inspectionState.status === 'loading' && (
              <p className="rounded border border-chalkboard-20 bg-chalkboard-20/40 px-3 py-2 text-sm dark:border-chalkboard-70 dark:bg-chalkboard-90">
                Loading conflict details...
              </p>
            )}

            {inspectionState.status === 'error' && (
              <p className="rounded border border-destroy-60 bg-destroy-10/50 px-3 py-2 text-sm text-destroy-80 dark:bg-destroy-80/20 dark:text-destroy-20">
                {inspectionState.message}
              </p>
            )}

            {inspectionState.status === 'ready' && (
              <ChangedFilesList
                files={inspectionState.inspection.changedFiles}
                resolvedTheme={resolvedTheme}
              />
            )}
          </div>

          <div className="border-t border-chalkboard-20 p-4 dark:border-chalkboard-70">
            <div className="grid gap-3 sm:grid-cols-2">
              <ActionButton
                Element="button"
                iconStart={{
                  icon: 'folder',
                  size: 'lg',
                  className: 'rounded-l-sm px-3',
                  bgClassName:
                    'bg-fern-20 text-fern-100 dark:bg-fern-80/50 dark:text-fern-10',
                  iconClassName: 'h-5 w-5',
                }}
                data-testid="use-local-data"
                disabled={resolving !== null || !inspection}
                tabIndex={0}
                onClick={() => void resolveConflict('local')}
                className="min-h-16 w-full justify-start border-fern-60 bg-fern-10/60 !pr-4 !text-sm font-semibold text-fern-110 hover:border-fern-70 hover:bg-fern-20/70 dark:border-fern-70 dark:bg-fern-100/30 dark:text-fern-10 dark:hover:border-fern-50 dark:hover:bg-fern-90/45"
              >
                <span className="flex flex-col items-start gap-1 py-2 text-left leading-tight">
                  <span>
                    {resolving === 'local'
                      ? 'Using local data...'
                      : 'Use local data'}
                  </span>
                  <span className="text-xs font-normal text-fern-90 dark:text-fern-20">
                    Upload local project. Saved{' '}
                    {formatDateTime(inspection?.localSavedAtMs)}
                  </span>
                </span>
              </ActionButton>
              <ActionButton
                Element="button"
                iconStart={{
                  icon: 'cloud',
                  size: 'lg',
                  className: 'rounded-l-sm px-3',
                  bgClassName:
                    'bg-river-20 text-river-100 dark:bg-river-80/55 dark:text-river-10',
                  iconClassName: 'h-5 w-5',
                }}
                data-testid="use-cloud-data"
                disabled={resolving !== null || !inspection}
                tabIndex={0}
                onClick={() => void resolveConflict('cloud')}
                className="min-h-16 w-full justify-start border-river-60 bg-river-10/70 !pr-4 !text-sm font-semibold text-river-110 hover:border-river-70 hover:bg-river-20/75 dark:border-river-70 dark:bg-river-100/35 dark:text-river-10 dark:hover:border-river-50 dark:hover:bg-river-90/50"
              >
                <span className="flex flex-col items-start gap-1 py-2 text-left leading-tight">
                  <span>
                    {resolving === 'cloud'
                      ? 'Using cloud data...'
                      : 'Use cloud data'}
                  </span>
                  <span className="text-xs font-normal text-river-90 dark:text-river-20">
                    Replace local project. Saved{' '}
                    {formatDateTime(inspection?.cloudSavedAtMs)}
                  </span>
                </span>
              </ActionButton>
            </div>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  )
}

function CloudSyncErrorDialog({
  request,
  onDismiss,
}: {
  request: CloudSyncErrorDialogRequest
  onDismiss: () => void
}) {
  const formattedTime = formatOptionalDateTime(request.occurredAt)

  return (
    <Dialog
      open={true}
      onClose={onDismiss}
      className="fixed inset-0 z-50 overflow-y-auto p-4"
    >
      <Dialog.Overlay className="fixed inset-0 bg-chalkboard-10/80 dark:bg-chalkboard-110/40" />
      <div className="relative flex min-h-full items-center justify-center">
        <Dialog.Panel
          className="relative flex w-[min(92vw,34rem)] flex-col rounded border border-destroy-40 bg-chalkboard-10 shadow-lg dark:border-destroy-80 dark:bg-chalkboard-100"
          data-testid="cloud-sync-error-dialog"
        >
          <div className="flex items-center justify-between gap-4 border-b border-chalkboard-20 p-4 dark:border-chalkboard-70">
            <div className="min-w-0 flex-1">
              <Dialog.Title as="h2" className="text-xl font-bold">
                {request.title}
              </Dialog.Title>
            </div>
            <button
              type="button"
              onClick={onDismiss}
              className="m-0 border-none p-0 bg-destroy-10/20 hover:bg-destroy-10 focus:bg-destroy-10 focus:outline-none focus:ring-0 dark:bg-destroy-80/20 dark:hover:bg-destroy-80/50 dark:focus:bg-destroy-80/50"
              data-testid="cloud-sync-error-close-button"
            >
              <CustomIcon name="close" className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-4 p-4 text-sm">
            <Dialog.Description as="div" className="space-y-2">
              {request.projectName && (
                <p className="break-words">
                  Cloud sync hit an error for{' '}
                  <span className="font-medium">{request.projectName}</span>.
                </p>
              )}
              {formattedTime && (
                <p className="text-chalkboard-70 dark:text-chalkboard-40">
                  Last reported {formattedTime}
                </p>
              )}
            </Dialog.Description>

            <p className="whitespace-pre-wrap break-words rounded border border-destroy-40 bg-destroy-10/50 px-3 py-2 text-destroy-80 dark:border-destroy-80 dark:bg-destroy-80/20 dark:text-destroy-20">
              {request.message}
            </p>
          </div>

          <div className="flex justify-end gap-2 border-t border-chalkboard-20 p-4 dark:border-chalkboard-70">
            <ActionButton
              Element="button"
              type="button"
              iconStart={{
                icon: 'refresh',
                size: 'sm',
                className: 'p-1',
                bgClassName: '!bg-transparent dark:!bg-transparent',
              }}
              onClick={() => {
                retryCloudSync()
                onDismiss()
              }}
              className="bg-primary text-white hover:bg-primary/90 dark:bg-primary dark:text-white dark:hover:bg-primary/90"
              data-testid="cloud-sync-error-retry-button"
            >
              Retry cloud sync
            </ActionButton>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  )
}

export function CloudConflictDialogHost({
  resolvedTheme,
}: {
  resolvedTheme: ResolvedTheme
}) {
  useSignals()
  const conflictDialog = cloudConflictDialogRequest.value

  useEffect(() => {
    return () => {
      cloudConflictDialogRequest.value = null
    }
  }, [])

  if (!conflictDialog) {
    return null
  }

  return (
    <CloudConflictDialog
      projectPath={conflictDialog.projectPath}
      projectName={conflictDialog.projectName}
      resolvedTheme={resolvedTheme}
      onDismiss={() => {
        cloudConflictDialogRequest.value = null
      }}
      onResolved={() => {
        cloudConflictDialogRequest.value = null
      }}
    />
  )
}

export function CloudSyncErrorDialogHost() {
  useSignals()
  const errorDialog = cloudSyncErrorDialogRequest.value

  useEffect(() => {
    return () => {
      cloudSyncErrorDialogRequest.value = null
    }
  }, [])

  if (!errorDialog) {
    return null
  }

  return (
    <CloudSyncErrorDialog
      request={errorDialog}
      onDismiss={() => {
        cloudSyncErrorDialogRequest.value = null
      }}
    />
  )
}
