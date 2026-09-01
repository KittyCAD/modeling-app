import { useSignals } from '@preact/signals-react/runtime'
import { useAppState } from '@src/AppState'
import { CustomIcon } from '@src/components/CustomIcon'
import { CleanPaneHeader } from '@src/components/layout/Panel/CleanPaneHeader'
import { Spinner } from '@src/components/Spinner'
import { isInterruptedExecutionErrorMessage } from '@src/lang/executionInterrupts'
import { useAiFirstCad } from '@src/lib/aiFirstCad/context'
import { getProjectKclFiles } from '@src/lib/aiFirstCad/projectFiles'
import {
  loadProjectSnapshotCache,
  revokeProjectSnapshotCache,
  writeProjectSnapshotCache,
} from '@src/lib/aiFirstCad/projectSnapshotCache'
import { useApp, useSingletons } from '@src/lib/boot'
import { PATHS } from '@src/lib/paths'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'
import { takeViewportScreenshot } from '@src/lib/screenshot'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

type ProjectSnapshot = {
  cachedUrl?: string
  dataUrl?: string
  error?: string
  isRegenerating?: boolean
  label: string
  path: string
}

const FILE_LOAD_TIMEOUT_MS = 20_000
const ENGINE_IDLE_TIMEOUT_MS = 60_000
const MIN_VIDEO_READY_STATE = 2
const VIDEO_FRAME_TIMEOUT_MS = 10_000
const VIDEO_FRAMES_TO_SETTLE = 2
const MAX_EXECUTION_ATTEMPTS = 2

const delay = (duration: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, duration))

function shouldOpenStream(locationState: unknown) {
  return (
    typeof locationState === 'object' &&
    locationState !== null &&
    'aiFirstCadShowStream' in locationState &&
    locationState.aiFirstCadShowStream === true
  )
}

async function waitForCondition(
  condition: () => boolean,
  timeout: number,
  timeoutMessage: string
) {
  const startedAt = performance.now()
  while (!condition()) {
    if (performance.now() - startedAt > timeout) {
      return Promise.reject(new Error(timeoutMessage))
    }
    await delay(75)
  }
}

async function waitForFreshVideoFrames() {
  const video = document.getElementById('video-stream')
  if (!(video instanceof HTMLVideoElement)) {
    return Promise.reject(new Error('The modeling stream is not available.'))
  }

  await waitForCondition(
    () =>
      video.readyState >= MIN_VIDEO_READY_STATE &&
      video.videoWidth > 0 &&
      video.videoHeight > 0,
    VIDEO_FRAME_TIMEOUT_MS,
    'Timed out waiting for the modeling stream.'
  )

  if (typeof video.requestVideoFrameCallback !== 'function') {
    await delay(350)
    return
  }

  for (let frame = 0; frame < VIDEO_FRAMES_TO_SETTLE; frame++) {
    await new Promise<void>((resolve, reject) => {
      let callbackId: number | undefined
      const timeoutId = window.setTimeout(() => {
        if (callbackId !== undefined) {
          video.cancelVideoFrameCallback(callbackId)
        }
        reject(new Error('Timed out waiting for a fresh modeling frame.'))
      }, VIDEO_FRAME_TIMEOUT_MS)

      callbackId = video.requestVideoFrameCallback(() => {
        window.clearTimeout(timeoutId)
        resolve()
      })
    })
  }
}

export function AiProjectView({
  active: activeProp,
}: {
  active?: boolean
} = {}) {
  useSignals()
  const { mode, projectEditRevision, setCanvasGridVisible } = useAiFirstCad()
  const active = activeProp ?? mode === 'ai'
  const { isStreamAcceptingInput, isStreamReady } = useAppState()
  const app = useApp()
  const { project, settings } = app
  const { kclManager } = useSingletons()
  const navigate = useNavigate()
  const location = useLocation()
  const [snapshots, setSnapshots] = useState<ProjectSnapshot[]>([])
  const [isCapturing, setIsCapturing] = useState(false)
  const [captureStatus, setCaptureStatus] = useState('')
  const [showGrid, setShowGrid] = useState(
    () => !shouldOpenStream(location.state)
  )
  const captureQueue = useRef<Promise<void>>(Promise.resolve())
  const cacheLoad = useRef<
    | {
        promise: Promise<Map<string, string>>
        requestId: string
      }
    | undefined
  >(undefined)
  const captureRunId = useRef(0)
  const activeExecutionRunId = useRef<number | null>(null)
  const isMounted = useRef(true)
  const activeRef = useRef(active)
  activeRef.current = active
  const currentProject = project?.projectIORefSignal.value
  const projectPath = currentProject?.path
  const currentProjectFiles = currentProject
    ? getProjectKclFiles(currentProject)
    : []
  const currentProjectFilesRef = useRef(currentProjectFiles)
  currentProjectFilesRef.current = currentProjectFiles
  const projectFileSetKey = currentProjectFiles
    .map((file) => `${file.path}\u0000${file.label}`)
    .join('\u0001')
  const captureRequestId = `${projectPath ?? 'no-project'}:${projectEditRevision}:${projectFileSetKey}`
  const captureRequestRef = useRef(captureRequestId)
  captureRequestRef.current = captureRequestId

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
    }
  }, [])

  useEffect(() => {
    if (!active) {
      return
    }

    setCanvasGridVisible(showGrid)
    return () => setCanvasGridVisible(false)
  }, [active, setCanvasGridVisible, showGrid])

  useEffect(() => {
    if (!active || !projectPath) {
      setSnapshots([])
      cacheLoad.current = undefined
      return
    }

    const files = currentProjectFilesRef.current
    const emptySnapshots = files.map((file) => ({
      ...file,
      isRegenerating: true,
    }))
    let disposed = false
    let loadedImages = new Map<string, string>()
    setSnapshots(emptySnapshots)

    const promise = loadProjectSnapshotCache(projectPath, files).then(
      (cachedImages) => {
        loadedImages = cachedImages
        if (disposed) {
          revokeProjectSnapshotCache(cachedImages)
          return new Map<string, string>()
        }
        setSnapshots(
          files.map((file) => {
            const cachedUrl = cachedImages.get(file.path)
            return {
              ...file,
              cachedUrl,
              isRegenerating: !cachedUrl,
            }
          })
        )
        return cachedImages
      }
    )
    cacheLoad.current = { promise, requestId: captureRequestId }

    return () => {
      disposed = true
      revokeProjectSnapshotCache(loadedImages)
    }
  }, [active, captureRequestId, projectPath])

  useEffect(() => {
    if (!active || !projectPath || !isStreamReady || !isStreamAcceptingInput) {
      return
    }

    const runId = ++captureRunId.current
    const captureProject = async () => {
      const captureProjectRef = app.project
      if (!captureProjectRef) {
        return
      }
      const captureProjectSnapshot = captureProjectRef.projectIORefSignal.value
      if (captureProjectSnapshot.path !== projectPath) {
        return
      }
      const isCurrentCapture = () =>
        isMounted.current &&
        activeRef.current &&
        captureRequestRef.current === captureRequestId &&
        captureRunId.current === runId &&
        app.project === captureProjectRef
      const executeForCapture = async () => {
        activeExecutionRunId.current = runId
        try {
          await kclManager.executeCode()
        } finally {
          if (activeExecutionRunId.current === runId) {
            activeExecutionRunId.current = null
          }
        }
      }

      const files = getProjectKclFiles(captureProjectSnapshot)
      const cachedImages =
        cacheLoad.current?.requestId === captureRequestId
          ? await cacheLoad.current.promise
          : new Map<string, string>()
      if (!isCurrentCapture()) {
        return
      }
      if (
        files.length > 0 &&
        files.every((file) => cachedImages.has(file.path))
      ) {
        setCaptureStatus('')
        setIsCapturing(false)
        return
      }
      const originalFilePath = captureProjectRef.executingFileEntry.value.path
      const nextSnapshots: ProjectSnapshot[] = files.map((file) => ({
        ...file,
        cachedUrl: cachedImages.get(file.path),
        isRegenerating: true,
      }))
      const publishSnapshot = (index: number, snapshot: ProjectSnapshot) => {
        nextSnapshots[index] = snapshot
        if (isCurrentCapture()) {
          setSnapshots([...nextSnapshots])
        }
      }

      if (isMounted.current) {
        setSnapshots(nextSnapshots)
        setIsCapturing(true)
        setCaptureStatus(
          files.length === 0
            ? 'No KCL files found'
            : `Rendering 1 of ${files.length}`
        )
      }

      try {
        for (const [index, file] of files.entries()) {
          if (!isCurrentCapture()) {
            return
          }
          setCaptureStatus(`Rendering ${index + 1} of ${files.length}`)

          try {
            const canReuseCurrentExecution =
              kclManager.path === file.path &&
              !kclManager.isExecuting &&
              !kclManager.hasErrors() &&
              kclManager.lastSuccessfulCode === kclManager.code

            if (kclManager.path !== file.path) {
              kclManager.switchedFiles = true
              await captureProjectRef.openEditor(file.path, kclManager)
            }
            await waitForCondition(
              () =>
                !isCurrentCapture() ||
                (captureProjectRef.executingPath === file.path &&
                  kclManager.path === file.path),
              FILE_LOAD_TIMEOUT_MS,
              `Timed out opening ${file.label}`
            )
            if (!isCurrentCapture()) {
              return
            }
            await waitForCondition(
              () => !isCurrentCapture() || !kclManager.isExecuting,
              ENGINE_IDLE_TIMEOUT_MS,
              `Timed out waiting to render ${file.label}`
            )
            await waitForCondition(
              () =>
                !isCurrentCapture() || kclManager.engineCommandManager.started,
              ENGINE_IDLE_TIMEOUT_MS,
              'Timed out connecting to the modeling engine'
            )
            if (!isCurrentCapture()) {
              return
            }

            if (!canReuseCurrentExecution) {
              for (
                let attempt = 0;
                attempt < MAX_EXECUTION_ATTEMPTS;
                attempt++
              ) {
                await executeForCapture()
                await waitForCondition(
                  () => !isCurrentCapture() || !kclManager.isExecuting,
                  ENGINE_IDLE_TIMEOUT_MS,
                  `Timed out waiting to render ${file.label}`
                )
                if (
                  !kclManager.hasErrors() &&
                  kclManager.lastSuccessfulCode === kclManager.code
                ) {
                  break
                }

                const canRetry =
                  !kclManager.hasParseErrors() &&
                  (kclManager.errors.length === 0 ||
                    kclManager.errors.every((error) =>
                      isInterruptedExecutionErrorMessage(error.msg)
                    ))
                if (!canRetry) {
                  break
                }
              }
            }
            if (kclManager.hasErrors()) {
              publishSnapshot(index, {
                ...file,
                cachedUrl: cachedImages.get(file.path),
                error: 'This file did not render successfully.',
                isRegenerating: false,
              })
              continue
            }
            if (kclManager.lastSuccessfulCode !== kclManager.code) {
              publishSnapshot(index, {
                ...file,
                cachedUrl: cachedImages.get(file.path),
                error:
                  'The modeling engine did not finish rendering this file.',
                isRegenerating: false,
              })
              continue
            }

            await resetCameraPosition({
              engineCommandManager: kclManager.engineCommandManager,
              sceneInfra: kclManager.sceneInfra,
              settingsActor: settings.actor,
            })
            await waitForFreshVideoFrames()
            const dataUrl = takeViewportScreenshot()
            if (!dataUrl) {
              publishSnapshot(index, {
                ...file,
                cachedUrl: cachedImages.get(file.path),
                error: 'The engine returned an empty snapshot.',
                isRegenerating: false,
              })
              continue
            }

            publishSnapshot(index, {
              ...file,
              dataUrl,
              isRegenerating: false,
            })
            try {
              await writeProjectSnapshotCache(projectPath, file.path, dataUrl)
            } catch (error) {
              console.warn(
                `Failed to cache the preview for ${file.label}`,
                error
              )
            }
          } catch (error) {
            if (!isCurrentCapture()) {
              return
            }
            publishSnapshot(index, {
              ...file,
              cachedUrl: cachedImages.get(file.path),
              error: error instanceof Error ? error.message : String(error),
              isRegenerating: false,
            })
          }
        }
      } finally {
        if (
          isMounted.current &&
          originalFilePath &&
          app.project === captureProjectRef &&
          kclManager.path !== originalFilePath
        ) {
          try {
            kclManager.switchedFiles = true
            await captureProjectRef.openEditor(originalFilePath, kclManager)
            if (kclManager.engineCommandManager.started) {
              await executeForCapture()
            }
          } catch (error) {
            console.warn('Failed to restore the original project file', error)
          }
        }
        if (isMounted.current && captureRunId.current === runId) {
          setSnapshots(nextSnapshots)
          setCaptureStatus('')
          setIsCapturing(false)
        }
      }
    }

    const enqueueTimer = setTimeout(() => {
      captureQueue.current = captureQueue.current
        .catch(() => undefined)
        .then(captureProject)
    }, 0)

    return () => {
      clearTimeout(enqueueTimer)
      captureRunId.current = runId + 1
      if (activeExecutionRunId.current === runId) {
        kclManager.cancelAllExecutions()
        activeExecutionRunId.current = null
      }
    }
  }, [
    captureRequestId,
    app,
    isStreamAcceptingInput,
    isStreamReady,
    kclManager,
    active,
    projectPath,
    settings.actor,
  ])

  const isWaitingForEngine =
    active && (!isStreamReady || !isStreamAcceptingInput)
  const isBusy = isCapturing || isWaitingForEngine

  if (!active) {
    return null
  }

  if (!showGrid) {
    return (
      <button
        className="absolute right-3 top-3 z-20 flex items-center gap-2 rounded-md border border-chalkboard-30 bg-chalkboard-10/90 px-3 py-2 text-sm font-semibold shadow-lg backdrop-blur hover:border-primary dark:border-chalkboard-70 dark:bg-chalkboard-90/90"
        onClick={() => setShowGrid(true)}
        type="button"
      >
        <CustomIcon className="h-4 w-4" name="layout" />
        Canvas
      </button>
    )
  }

  return (
    <div className="absolute inset-0 z-10 flex flex-col overflow-hidden bg-chalkboard-20 dark:bg-[#181818]">
      <CleanPaneHeader title="Canvas" />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {snapshots.length === 0 ? (
          <div className="grid h-full min-h-56 place-content-center text-center">
            <CustomIcon
              className={`mx-auto mb-3 h-8 w-8 text-primary ${isBusy ? 'animate-pulse' : ''}`}
              name="sparkles"
            />
            <p className="m-0 font-semibold">
              {isWaitingForEngine
                ? 'Connecting to the modeling engine'
                : isCapturing
                  ? captureStatus
                  : 'No KCL snapshots yet'}
            </p>
            <p className="mt-1 text-sm text-chalkboard-60 dark:text-chalkboard-40">
              AI edits rebuild this project view automatically.
            </p>
          </div>
        ) : (
          <div
            aria-busy={isCapturing}
            className={`grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4 ${
              isCapturing ? 'opacity-60' : ''
            }`}
          >
            {snapshots.map((snapshot) => {
              const imageUrl = snapshot.dataUrl || snapshot.cachedUrl
              const usesCachedSnapshot =
                !snapshot.dataUrl && Boolean(snapshot.cachedUrl)

              return (
                <button
                  aria-label={`Open ${snapshot.label}`}
                  className="group m-0 min-w-0 border-none bg-transparent p-0 text-left shadow-none hover:bg-transparent"
                  key={snapshot.path}
                  onClick={() => {
                    setShowGrid(false)
                    void navigate(
                      `${PATHS.FILE}/${encodeURIComponent(snapshot.path)}`,
                      { state: { aiFirstCadShowStream: true } }
                    )
                  }}
                  type="button"
                >
                  <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-chalkboard-30 bg-chalkboard-30 shadow-sm transition group-hover:-translate-y-0.5 group-hover:border-primary group-hover:shadow-md dark:border-chalkboard-70 dark:bg-chalkboard-110">
                    {imageUrl ? (
                      <img
                        alt={
                          usesCachedSnapshot
                            ? `Cached 3D snapshot of ${snapshot.label}`
                            : `3D snapshot of ${snapshot.label}`
                        }
                        className="h-full w-full scale-[1.25] object-cover transition-transform group-hover:scale-[1.3]"
                        src={imageUrl}
                      />
                    ) : null}
                    {snapshot.isRegenerating ? (
                      <output
                        aria-label={`Regenerating preview for ${snapshot.label}`}
                        className={`pointer-events-none absolute inset-0 grid place-content-center gap-2 text-center text-sm text-chalkboard-60 dark:text-chalkboard-30 ${
                          imageUrl ? 'bg-[#181818]/50 backdrop-blur-[1px]' : ''
                        }`}
                      >
                        <Spinner className="mx-auto h-6 w-6" />
                        <span>Regenerating preview</span>
                      </output>
                    ) : !imageUrl ? (
                      <div className="grid h-full place-content-center px-5 text-center text-sm text-chalkboard-60 dark:text-chalkboard-40">
                        <CustomIcon
                          className="mx-auto mb-2 h-6 w-6"
                          name="triangleExclamation"
                        />
                        {snapshot.error || 'Snapshot unavailable'}
                      </div>
                    ) : null}
                  </div>
                  <span
                    className="mt-2 block min-w-0 truncate px-1 text-sm font-semibold"
                    title={snapshot.label}
                  >
                    {snapshot.label}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
