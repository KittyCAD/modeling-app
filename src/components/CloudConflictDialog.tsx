import { Dialog } from '@headlessui/react'
import { markdown } from '@codemirror/lang-markdown'
import { MergeView } from '@codemirror/merge'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { kcl } from '@kittycad/codemirror-lang-kcl'
import { useSignals } from '@preact/signals-react/runtime'
import { Fragment, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'

import { ActionButton } from '@src/components/ActionButton'
import { CustomIcon } from '@src/components/CustomIcon'
import {
  editorMarkdownHighlight,
  editorTheme,
  editorVisualTheme,
} from '@src/editor/plugins/theme'
import { useApp } from '@src/lib/boot'
import {
  type CloudSyncConflictResolution,
  type CloudSyncProjectMetadata,
  cloudSyncStatus,
  getCloudSyncProjectMetadata,
  getCloudSyncProjectMetadataIndex,
  resolveCloudSyncProjectConflict,
} from '@src/lib/cloudSync'
import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import fsZds from '@src/lib/fs-zds'
import { fsZdsConstants } from '@src/lib/fs-zds/constants'
import { getProjectTitleFromProjectTomlContents } from '@src/lib/projectTomlMetadata'
import { getResolvedTheme } from '@src/lib/theme'
import { reportRejection } from '@src/lib/trap'

type CloudConflictDialogProps = {
  projectPath: string
  projectName?: string
  onDismiss: () => void
  onResolved?: () => void
}

type ScannedProjectFile = {
  absolutePath: string
  data: Uint8Array
  modifiedAtMs: number
  relativePath: string
  size: number
}

type ConflictFileStatus = 'changed' | 'local-only' | 'cloud-only'

type ConflictFileComparison = {
  status: ConflictFileStatus
  relativePath: string
  local?: ScannedProjectFile
  cloud?: ScannedProjectFile
  localText?: string
  cloudText?: string
  textUnavailableReason?: string
}

type ConflictInspection = {
  projectTitle?: string
  remoteProjectId?: string
  localSavedAtMs?: number
  cloudSavedAtMs?: number
  changedFiles: ConflictFileComparison[]
}

type ConflictInspectionState =
  | { status: 'loading' }
  | { status: 'ready'; inspection: ConflictInspection }
  | { status: 'error'; message: string }

const INTERNAL_OPFS_META_FILE = '._meta'
const MAX_MERGE_TEXT_BYTES = 512 * 1024
const textDecoder = new TextDecoder('utf-8', { fatal: true })

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function normalizeRelativePath(relativePath: string) {
  return relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
}

function statIsDirectory(mode: number) {
  return Boolean(mode & fsZdsConstants.S_IFDIR)
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) {
    return false
  }

  for (let index = 0; index < left.byteLength; index++) {
    if (left[index] !== right[index]) {
      return false
    }
  }

  return true
}

function formatDateTime(dateTimeMs: number | undefined) {
  if (dateTimeMs === undefined || Number.isNaN(dateTimeMs)) {
    return 'Unknown'
  }

  return new Date(dateTimeMs).toLocaleString()
}

function formatFileSize(size: number | undefined) {
  if (size === undefined) {
    return '—'
  }

  if (size < 1024) {
    return `${size} B`
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`
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
    return 'bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary'
  }
  if (status === 'cloud-only') {
    return 'bg-green-10 text-green-80 dark:bg-green-80/20 dark:text-green-20'
  }
  return 'bg-warn-20 text-warn-90 dark:bg-warn-80/30 dark:text-warn-10'
}

function decodeMergeableText(file: ScannedProjectFile | undefined) {
  if (!file) {
    return ''
  }

  if (file.data.byteLength > MAX_MERGE_TEXT_BYTES) {
    return undefined
  }

  try {
    const text = textDecoder.decode(file.data)
    if (text.includes('\u0000')) {
      return undefined
    }
    return text
  } catch {
    return undefined
  }
}

function getTextUnavailableReason(
  local: ScannedProjectFile | undefined,
  cloud: ScannedProjectFile | undefined,
  localText: string | undefined,
  cloudText: string | undefined
) {
  const largestSize = Math.max(local?.size ?? 0, cloud?.size ?? 0)
  if (largestSize > MAX_MERGE_TEXT_BYTES) {
    return `File is larger than ${formatFileSize(MAX_MERGE_TEXT_BYTES)}.`
  }

  if (localText === undefined || cloudText === undefined) {
    return 'Binary or non-UTF-8 file.'
  }

  return undefined
}

function latestModifiedAt(files: Iterable<ScannedProjectFile>) {
  let latest: number | undefined
  for (const file of files) {
    latest =
      latest === undefined
        ? file.modifiedAtMs
        : Math.max(latest, file.modifiedAtMs)
  }
  return latest
}

function getProjectTitleFromScannedFiles(
  files: Map<string, ScannedProjectFile>
) {
  const projectToml = files.get(PROJECT_SETTINGS_FILE_NAME)
  const projectTomlText = decodeMergeableText(projectToml)
  return projectTomlText
    ? getProjectTitleFromProjectTomlContents(projectTomlText)
    : undefined
}

async function scanProjectFiles(projectRoot: string) {
  const files = new Map<string, ScannedProjectFile>()

  async function walk(currentPath: string) {
    const entries = (await fsZds.readdir(currentPath)).toSorted()

    for (const entry of entries) {
      if (entry === INTERNAL_OPFS_META_FILE) {
        continue
      }

      const absolutePath = fsZds.join(currentPath, entry)
      const stat = await fsZds.stat(absolutePath)
      if (statIsDirectory(stat.mode)) {
        await walk(absolutePath)
        continue
      }

      const relativePath = normalizeRelativePath(
        fsZds.relative(projectRoot, absolutePath) ?? ''
      )
      const data = Uint8Array.from(await fsZds.readFile(absolutePath))
      files.set(relativePath, {
        absolutePath,
        data,
        modifiedAtMs: stat.mtimeMs,
        relativePath,
        size: data.byteLength,
      })
    }
  }

  await walk(projectRoot)
  return files
}

function buildChangedFileComparison({
  relativePath,
  local,
  cloud,
}: {
  relativePath: string
  local?: ScannedProjectFile
  cloud?: ScannedProjectFile
}): ConflictFileComparison | undefined {
  if (local && cloud && bytesEqual(local.data, cloud.data)) {
    return undefined
  }

  const localText = decodeMergeableText(local)
  const cloudText = decodeMergeableText(cloud)

  return {
    status: local && cloud ? 'changed' : local ? 'local-only' : 'cloud-only',
    relativePath,
    local,
    cloud,
    localText,
    cloudText,
    textUnavailableReason: getTextUnavailableReason(
      local,
      cloud,
      localText,
      cloudText
    ),
  }
}

async function loadConflictInspection(
  projectPath: string
): Promise<ConflictInspection> {
  const metadata = await getCloudSyncProjectMetadata(projectPath)
  if (!metadata?.conflict) {
    throw new Error('Cloud conflict metadata was not found for this project.')
  }

  const conflictProjectPath = metadata.conflict.conflictProjectPath
  const [localFiles, cloudFiles] = await Promise.all([
    scanProjectFiles(projectPath),
    scanProjectFiles(conflictProjectPath),
  ])
  const relativePaths = new Set([...localFiles.keys(), ...cloudFiles.keys()])
  const changedFiles: ConflictFileComparison[] = []

  for (const relativePath of Array.from(relativePaths).toSorted()) {
    const comparison = buildChangedFileComparison({
      relativePath,
      local: localFiles.get(relativePath),
      cloud: cloudFiles.get(relativePath),
    })

    if (comparison) {
      changedFiles.push(comparison)
    }
  }

  return {
    projectTitle:
      getProjectTitleFromScannedFiles(localFiles) ??
      getProjectTitleFromScannedFiles(cloudFiles),
    remoteProjectId: metadata.remoteProjectId,
    localSavedAtMs: latestModifiedAt(localFiles.values()),
    cloudSavedAtMs: Date.parse(metadata.conflict.createdAt),
    changedFiles,
  }
}

function mergeLanguageExtensions(
  relativePath: string,
  resolvedTheme: 'light' | 'dark'
) {
  const extension = fsZds.extname(relativePath).toLowerCase()
  if (extension === '.kcl') {
    return [kcl(), ...editorTheme[resolvedTheme]]
  }
  if (extension === '.md' || extension === '.markdown') {
    return [
      markdown(),
      editorVisualTheme[resolvedTheme],
      editorMarkdownHighlight[resolvedTheme],
    ]
  }
  return [editorVisualTheme[resolvedTheme]]
}

const mergeEditorTheme = EditorView.theme({
  '&': {
    maxWidth: '100%',
    minHeight: '8rem',
    minWidth: 0,
  },
  '.cm-scroller': {
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    overflowX: 'auto',
  },
  '.cm-content': {
    paddingBlock: '0.5rem',
  },
  '.cm-line': {
    paddingInline: '0.5rem',
  },
  '&.cm-focused': {
    outline: 'none',
  },
})

function mergeEditorExtensions(
  relativePath: string,
  resolvedTheme: 'light' | 'dark'
): Extension[] {
  return [
    ...mergeLanguageExtensions(relativePath, resolvedTheme),
    mergeEditorTheme,
    lineNumbers(),
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
  ]
}

function ConflictMergeView({
  comparison,
  resolvedTheme,
}: {
  comparison: ConflictFileComparison
  resolvedTheme: 'light' | 'dark'
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    const mergeView = new MergeView({
      a: {
        doc: comparison.localText ?? '',
        extensions: mergeEditorExtensions(
          comparison.relativePath,
          resolvedTheme
        ),
      },
      b: {
        doc: comparison.cloudText ?? '',
        extensions: mergeEditorExtensions(
          comparison.relativePath,
          resolvedTheme
        ),
      },
      parent: containerRef.current,
      highlightChanges: true,
      gutter: true,
      revertControls: undefined,
      collapseUnchanged: {
        margin: 3,
        minSize: 8,
      },
      diffConfig: {
        timeout: 1000,
      },
    })

    return () => {
      mergeView.destroy()
    }
  }, [
    comparison.cloudText,
    comparison.localText,
    comparison.relativePath,
    resolvedTheme,
  ])

  return (
    <div
      ref={containerRef}
      className="max-h-[18rem] min-h-32 w-full max-w-full min-w-0 overflow-auto rounded border border-chalkboard-20 dark:border-chalkboard-70 [&_.cm-editor]:max-w-full [&_.cm-editor]:min-w-0 [&_.cm-mergeView]:max-h-[18rem] [&_.cm-mergeView]:max-w-full [&_.cm-mergeView]:min-w-0 [&_.cm-mergeView]:overflow-auto [&_.cm-mergeView]:w-full [&_.cm-mergeViewEditor]:max-w-full [&_.cm-mergeViewEditor]:min-w-0 [&_.cm-mergeViewEditors]:max-w-full [&_.cm-mergeViewEditors]:min-w-0 [&_.cm-mergeViewEditors]:w-full [&_.cm-scroller]:overflow-auto"
    />
  )
}

function canShowDiff(file: ConflictFileComparison) {
  return !file.textUnavailableReason
}

function ChangedFilesTable({
  files,
  resolvedTheme,
}: {
  files: ConflictFileComparison[]
  resolvedTheme: 'light' | 'dark'
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
    <div className="max-w-full overflow-x-auto overflow-y-visible rounded border border-chalkboard-20 text-xs dark:border-chalkboard-70">
      <table className="w-full min-w-[42rem] table-fixed border-collapse">
        <thead className="sticky top-0 bg-chalkboard-20 text-left text-chalkboard-70 dark:bg-chalkboard-90 dark:text-chalkboard-20">
          <tr>
            <th className="px-3 py-2 font-medium">File</th>
            <th className="w-28 px-3 py-2 font-medium">Change</th>
            <th className="w-40 px-3 py-2 font-medium">Local saved</th>
            <th className="w-40 px-3 py-2 font-medium">Cloud saved</th>
            <th className="w-32 px-3 py-2 text-right font-medium">Size</th>
          </tr>
        </thead>
        <tbody>
          {files.map((file) => {
            const showDiff = canShowDiff(file)
            const expanded = expandedPaths.has(file.relativePath)
            const diffId = `cloud-conflict-diff-${file.relativePath.replace(
              /[^a-zA-Z0-9_-]/g,
              '-'
            )}`

            return (
              <Fragment key={file.relativePath}>
                <tr className="border-t border-chalkboard-20 dark:border-chalkboard-70">
                  <td className="max-w-0 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <button
                        type="button"
                        aria-controls={diffId}
                        aria-expanded={expanded}
                        onClick={() => toggleExpanded(file.relativePath)}
                        className="m-0 flex h-5 w-5 shrink-0 items-center justify-center border-none p-0 text-chalkboard-70 hover:bg-chalkboard-20 focus:bg-chalkboard-20 focus:outline-none focus:ring-0 dark:text-chalkboard-30 dark:hover:bg-chalkboard-80 dark:focus:bg-chalkboard-80"
                        data-testid={`cloud-conflict-file-toggle-${file.relativePath}`}
                      >
                        <CustomIcon
                          name="caretDown"
                          className={`h-4 w-4 transition-transform ${
                            expanded ? '' : '-rotate-90'
                          }`}
                        />
                      </button>
                      <span className="truncate" title={file.relativePath}>
                        {file.relativePath}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-1.5 py-0.5 font-medium ${statusBadgeClassName(
                        file.status
                      )}`}
                    >
                      {conflictStatusLabel(file.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {formatDateTime(file.local?.modifiedAtMs)}
                  </td>
                  <td className="px-3 py-2">
                    {formatDateTime(file.cloud?.modifiedAtMs)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {formatFileSize(file.local?.size)}
                    {' / '}
                    {formatFileSize(file.cloud?.size)}
                  </td>
                </tr>
                {expanded && (
                  <tr
                    id={diffId}
                    className="border-t border-chalkboard-20 bg-chalkboard-10 dark:border-chalkboard-70 dark:bg-chalkboard-100"
                  >
                    <td colSpan={5} className="max-w-0 p-3">
                      {showDiff ? (
                        <>
                          <div className="mb-2 grid grid-cols-2 gap-3 text-xs font-medium text-chalkboard-70 dark:text-chalkboard-30">
                            <span>Local</span>
                            <span>Cloud</span>
                          </div>
                          <ConflictMergeView
                            comparison={file}
                            resolvedTheme={resolvedTheme}
                          />
                        </>
                      ) : (
                        <p className="rounded border border-chalkboard-20 bg-chalkboard-20/40 px-3 py-2 text-sm text-chalkboard-70 dark:border-chalkboard-70 dark:bg-chalkboard-90 dark:text-chalkboard-30">
                          Diff unavailable: {file.textUnavailableReason}
                        </p>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function useCloudSyncProjectConflict(projectPath?: string) {
  useSignals()
  const status = cloudSyncStatus.value
  const [metadata, setMetadata] = useState<
    CloudSyncProjectMetadata | undefined
  >()

  useEffect(() => {
    let cancelled = false

    if (!status.enabled || !projectPath) {
      setMetadata(undefined)
      return
    }

    getCloudSyncProjectMetadata(projectPath)
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

export function useCloudSyncProjectConflicts() {
  useSignals()
  const status = cloudSyncStatus.value
  const [metadata, setMetadata] = useState<
    CloudSyncProjectMetadata[] | undefined
  >()

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
  onDismiss,
  onResolved,
}: CloudConflictDialogProps) {
  const { settings } = useApp()
  const settingsValues = settings.useSettings()
  const resolvedTheme = getResolvedTheme(settingsValues.app.theme.current)
  const [resolving, setResolving] =
    useState<CloudSyncConflictResolution | null>(null)
  const [inspectionState, setInspectionState] =
    useState<ConflictInspectionState>({ status: 'loading' })
  const inspection =
    inspectionState.status === 'ready' ? inspectionState.inspection : undefined
  const displayProjectName = inspection
    ? inspection.projectTitle || projectName
    : undefined
  const projectNameCopy = displayProjectName
    ? `"${displayProjectName}"`
    : 'this project'
  const cloudIdSuffix = inspection?.remoteProjectId
    ? ` (cloud ID: ${inspection.remoteProjectId})`
    : ''

  useEffect(() => {
    let cancelled = false
    setInspectionState({ status: 'loading' })

    loadConflictInspection(projectPath)
      .then((inspection) => {
        if (!cancelled) {
          setInspectionState({ status: 'ready', inspection })
        }
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
  }, [projectPath])

  async function resolveConflict(resolution: CloudSyncConflictResolution) {
    setResolving(resolution)
    try {
      await resolveCloudSyncProjectConflict(projectPath, resolution)
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
    <Dialog
      open={true}
      onClose={onDismiss}
      className="fixed inset-0 z-50 overflow-y-auto p-4"
    >
      <Dialog.Overlay className="fixed inset-0 bg-chalkboard-10/80 dark:bg-chalkboard-110/40" />
      <div className="relative flex min-h-full items-center justify-center">
        <Dialog.Panel
          className="relative flex h-[min(90vh,56rem)] w-[min(96vw,82rem)] flex-col rounded border border-warn-70 bg-chalkboard-10 shadow-lg dark:border-warn-80 dark:bg-chalkboard-100"
          data-testid="cloud-conflict-dialog"
        >
          <div className="flex items-start justify-between gap-4 border-b border-chalkboard-20 p-4 dark:border-chalkboard-70">
            <div className="min-w-0">
              <Dialog.Title as="h2" className="text-2xl font-bold">
                Resolve conflicts to resume cloud sync
              </Dialog.Title>
            </div>
            <button
              type="button"
              onClick={onDismiss}
              disabled={resolving !== null}
              className="m-0 border-none p-0 hover:bg-destroy-10 focus:bg-destroy-10 focus:outline-none focus:ring-0 disabled:opacity-50 dark:hover:bg-destroy-80/50 dark:focus:bg-destroy-80/50"
              data-testid="cloud-conflict-close-button"
            >
              <CustomIcon name="close" className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-auto p-4">
            <Dialog.Description
              as="div"
              className="space-y-2 text-sm max-w-3xl my-4"
            >
              <p className="break-words">
                Local and cloud data both changed for {projectNameCopy}
                {cloudIdSuffix}. Review the saved versions, then choose which
                version should become the project source of truth.
              </p>
              <p>
                Using local data uploads your current local project to the
                cloud. Using cloud data replaces the local project with the
                conflicted cloud version that was saved locally.
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
              <ChangedFilesTable
                files={inspectionState.inspection.changedFiles}
                resolvedTheme={resolvedTheme}
              />
            )}
          </div>

          <div className="border-t border-chalkboard-20 p-4 dark:border-chalkboard-70">
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
              <div className="min-w-40 text-right text-xs text-chalkboard-70 dark:text-chalkboard-30">
                <div className="font-medium">Local version</div>
                <div>Saved {formatDateTime(inspection?.localSavedAtMs)}</div>
              </div>
              <ActionButton
                Element="button"
                data-testid="use-local-data"
                disabled={resolving !== null}
                tabIndex={0}
                onClick={() => void resolveConflict('local')}
                className="border-warn-70 bg-warn-10/30 py-1 dark:bg-warn-80/20"
              >
                {resolving === 'local'
                  ? 'Using local data...'
                  : 'Use local data'}
              </ActionButton>
              <ActionButton
                Element="button"
                data-testid="use-cloud-data"
                disabled={resolving !== null}
                tabIndex={0}
                onClick={() => void resolveConflict('cloud')}
                className="py-1"
              >
                {resolving === 'cloud'
                  ? 'Using cloud data...'
                  : 'Use cloud data'}
              </ActionButton>
              <div className="min-w-40 text-xs text-chalkboard-70 dark:text-chalkboard-30">
                <div className="font-medium">Cloud version</div>
                <div>Saved {formatDateTime(inspection?.cloudSavedAtMs)}</div>
              </div>
            </div>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  )
}
