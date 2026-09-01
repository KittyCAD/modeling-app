import { useSignals } from '@preact/signals-react/runtime'
import { CustomIcon } from '@src/components/CustomIcon'
import { FileExplorerPreviewProvider } from '@src/components/Explorer/FileExplorerPreviewContext'
import { PaneContentSelectorProvider } from '@src/components/layout/Panel/PaneContentSelector'
import { getProjectKclFiles } from '@src/lib/aiFirstCad/projectFiles'
import {
  loadProjectSnapshotCache,
  revokeProjectSnapshotCache,
} from '@src/lib/aiFirstCad/projectSnapshotCache'
import {
  getWorkspacePaneAreaType,
  getWorkspacePaneLabel,
  WORKSPACE_PANE_OPTIONS,
  type WorkspacePaneContent,
} from '@src/lib/aiFirstCad/workspacePanes'
import { useApp } from '@src/lib/boot'
import { type AreaLibrary, AreaType, LayoutType } from '@src/lib/layout/types'
import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react'

const FILE_PREVIEW_MIN_WIDTH = 240
const DEFAULT_DRAWER_WIDTH = 288
const MIN_DRAWER_WIDTH = 192
const MAX_DRAWER_WIDTH = 640
const DRAWER_KEYBOARD_RESIZE_STEP = 16

const getMaximumDrawerWidth = () =>
  Math.max(
    MIN_DRAWER_WIDTH,
    Math.min(MAX_DRAWER_WIDTH, window.innerWidth * 0.45)
  )

type WorkspaceDrawerSide = 'left' | 'right'

type WorkspaceDrawerProps = {
  areaLibrary: AreaLibrary
  collapsed: boolean
  content: WorkspacePaneContent
  onContentChange: (content: WorkspacePaneContent) => void
  side: WorkspaceDrawerSide
}

type SharedProjectFilesPaneProps = {
  areaLibrary: AreaLibrary
  inactive?: boolean
  layoutId?: string
}

export function SharedProjectFilesPane({
  areaLibrary,
  inactive = false,
  layoutId = 'shared-project-files',
}: SharedProjectFilesPaneProps) {
  useSignals()
  const { project } = useApp()
  const filesArea = areaLibrary[AreaType.Files]
  const paneRef = useRef<HTMLDivElement>(null)
  const [previewUrls, setPreviewUrls] = useState<Map<string, string>>(
    () => new Map()
  )
  const [showPreviews, setShowPreviews] = useState(false)
  const currentProject = project?.projectIORefSignal.value
  const projectPath = currentProject?.path

  useEffect(() => {
    const pane = paneRef.current
    if (!pane) {
      return
    }

    const updatePreviewVisibility = (width: number) => {
      setShowPreviews(!inactive && width >= FILE_PREVIEW_MIN_WIDTH)
    }

    updatePreviewVisibility(pane.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        updatePreviewVisibility(entry.contentRect.width)
      }
    })
    observer.observe(pane)

    return () => observer.disconnect()
  }, [inactive])

  useEffect(() => {
    let disposed = false
    let loadedImages = new Map<string, string>()
    setPreviewUrls(new Map())

    if (inactive || !currentProject || !projectPath) {
      return
    }

    void loadProjectSnapshotCache(
      projectPath,
      getProjectKclFiles(currentProject)
    ).then((cachedImages) => {
      if (disposed) {
        revokeProjectSnapshotCache(cachedImages)
        return
      }
      loadedImages = cachedImages
      setPreviewUrls(cachedImages)
    })

    return () => {
      disposed = true
      revokeProjectSnapshotCache(loadedImages)
    }
  }, [inactive, currentProject, projectPath])

  if (!filesArea) {
    return null
  }

  const { Component, ...areaConfig } = filesArea

  return (
    <div ref={paneRef} className="flex h-full min-w-0 flex-1 overflow-hidden">
      <FileExplorerPreviewProvider
        previewUrls={previewUrls}
        showPreviews={showPreviews}
      >
        <Component
          areaConfig={areaConfig}
          layout={{
            id: layoutId,
            label: 'Project Files',
            type: LayoutType.Simple,
            areaType: AreaType.Files,
          }}
        />
      </FileExplorerPreviewProvider>
    </div>
  )
}

export function WorkspaceDrawer({
  areaLibrary,
  collapsed,
  content,
  onContentChange,
  side,
}: WorkspaceDrawerProps) {
  const [drawerWidth, setDrawerWidth] = useState(DEFAULT_DRAWER_WIDTH)
  const [isResizing, setIsResizing] = useState(false)
  const activePointerId = useRef<number | null>(null)
  const dragStart = useRef({ clientX: 0, width: DEFAULT_DRAWER_WIDTH })
  const borderClassName =
    side === 'left'
      ? 'border-r border-chalkboard-30 dark:border-chalkboard-80'
      : 'border-l border-chalkboard-30 dark:border-chalkboard-80'
  const handlePositionClassName = side === 'left' ? 'right-0' : 'left-0'

  const clampWidth = (width: number) =>
    Math.min(Math.max(MIN_DRAWER_WIDTH, width), getMaximumDrawerWidth())

  const resizeFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== event.pointerId) {
      return
    }
    const pointerDelta = event.clientX - dragStart.current.clientX
    const widthDelta = side === 'left' ? pointerDelta : -pointerDelta
    setDrawerWidth(clampWidth(dragStart.current.width + widthDelta))
  }

  const finishResize = (event: PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== event.pointerId) {
      return
    }
    activePointerId.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setIsResizing(false)
  }

  const resizeFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return
    }
    event.preventDefault()
    const boundaryDelta =
      event.key === 'ArrowRight'
        ? DRAWER_KEYBOARD_RESIZE_STEP
        : -DRAWER_KEYBOARD_RESIZE_STEP
    setDrawerWidth((width) =>
      clampWidth(width + (side === 'left' ? boundaryDelta : -boundaryDelta))
    )
  }

  return (
    <aside
      aria-label={`${side === 'left' ? 'Left' : 'Right'} workspace drawer`}
      aria-hidden={collapsed}
      className={`relative h-full min-w-0 flex-none overflow-hidden ${
        isResizing ? '' : 'transition-[width,opacity] duration-200 ease-out'
      } ${collapsed ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
      data-collapsed={collapsed}
      data-pane-content={content}
      data-testid={`workspace-${side}-drawer`}
      style={{ width: collapsed ? 0 : drawerWidth }}
    >
      <div className={`flex h-full w-full min-w-0 ${borderClassName}`}>
        <PaneContentSelectorProvider
          currentId={content}
          onSelect={(nextContent) =>
            onContentChange(nextContent as WorkspacePaneContent)
          }
          options={WORKSPACE_PANE_OPTIONS}
        >
          {content === 'files' ? (
            <SharedProjectFilesPane
              areaLibrary={areaLibrary}
              inactive={collapsed}
              layoutId={`workspace-${side}-files`}
            />
          ) : (
            <RegisteredWorkspacePane
              areaLibrary={areaLibrary}
              content={content}
              side={side}
            />
          )}
        </PaneContentSelectorProvider>
      </div>
      {!collapsed ? (
        <div
          aria-label={`Resize ${side} workspace drawer`}
          aria-orientation="vertical"
          aria-valuemax={getMaximumDrawerWidth()}
          aria-valuemin={MIN_DRAWER_WIDTH}
          aria-valuenow={Math.round(drawerWidth)}
          className={`group/handle absolute bottom-0 top-0 z-40 w-4 cursor-col-resize touch-none focus-visible:outline-none ${handlePositionClassName}`}
          data-resizing={isResizing}
          data-testid={`workspace-${side}-drawer-resize-handle`}
          onDoubleClick={() => setDrawerWidth(DEFAULT_DRAWER_WIDTH)}
          onKeyDown={resizeFromKeyboard}
          onLostPointerCapture={() => {
            activePointerId.current = null
            setIsResizing(false)
          }}
          onPointerDown={(event) => {
            event.preventDefault()
            activePointerId.current = event.pointerId
            dragStart.current = { clientX: event.clientX, width: drawerWidth }
            event.currentTarget.setPointerCapture(event.pointerId)
            setIsResizing(true)
          }}
          onPointerMove={resizeFromPointer}
          onPointerCancel={finishResize}
          onPointerUp={finishResize}
          role="slider"
          tabIndex={0}
        >
          <div
            className={`absolute bottom-0 left-1/2 top-0 w-px -translate-x-1/2 ${
              isResizing ? 'bg-4' : 'bg-transparent group-hover/handle:bg-4'
            }`}
          />
          <div className="absolute left-1/2 top-1/2 z-10 hidden -translate-x-1/2 -translate-y-1/2 place-content-center rounded-sm border bg-3 py-1 group-hover/handle:grid group-focus-visible/handle:grid group-data-[resizing=true]/handle:grid">
            <CustomIcon className="-mx-0.5 h-4 w-4 rotate-90" name="sixDots" />
          </div>
        </div>
      ) : null}
    </aside>
  )
}

function RegisteredWorkspacePane({
  areaLibrary,
  content,
  side,
}: {
  areaLibrary: AreaLibrary
  content: WorkspacePaneContent
  side: WorkspaceDrawerSide
}) {
  const areaType = getWorkspacePaneAreaType(content)
  const area = areaLibrary[areaType]
  if (!area) {
    return null
  }

  const { Component, ...areaConfig } = area
  return (
    <div className="h-full min-h-0 min-w-0 flex-1 overflow-hidden">
      <Component
        areaConfig={areaConfig}
        layout={{
          id: `workspace-${side}-drawer-${content}`,
          label: getWorkspacePaneLabel(content),
          type: LayoutType.Simple,
          areaType,
        }}
      />
    </div>
  )
}
