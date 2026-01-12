import {
  kclManager,
  getLayout,
  getSettings,
  setLayout,
  useToken,
} from '@src/lib/singletons'

import { ConnectionStream } from '@src/components/ConnectionStream'
import Gizmo from '@src/components/gizmo/Gizmo'
import { Toolbar } from '@src/Toolbar'
import type { AreaType, AreaTypeDefinition } from '@src/lib/layout/types'
import { isDesktop } from '@src/lib/isDesktop'
import { kclErrorsByFilename } from '@src/lang/errors'
import type { MouseEventHandler } from 'react'
import { useMemo, useRef } from 'react'
import { togglePaneLayoutNode } from '@src/lib/layout/utils'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'
import { ProjectExplorerPane } from '@src/components/layout/areas/ProjectExplorerPane'
import { KclEditorPane } from '@src/components/layout/areas/KclEditorPane'
import { MlEphantConversationPaneWrapper } from '@src/components/layout/areas/MlEphantConversationPaneWrapper'
import { FeatureTreePane } from '@src/components/layout/areas/FeatureTreePane'
import { MemoryPane } from '@src/components/layout/areas/MemoryPane'
import { LogsPane } from '@src/components/layout/areas/LoggingPanes'
import { DebugPane } from '@src/components/layout/areas/DebugPane'
import Draggable from '@src/components/Draggable'
import { CustomIcon } from '@src/components/CustomIcon'

const onCodeNotificationClick: MouseEventHandler = (e) => {
  e.preventDefault()
  const rootLayout = structuredClone(getLayout())
  setLayout(
    togglePaneLayoutNode({
      rootLayout,
      targetNodeId: DefaultLayoutPaneID.Code,
      shouldExpand: true,
    })
  )
  kclManager.scrollToFirstErrorDiagnosticIfExists()
}

const Handle = () => (
  <div className="flex justify-center hover:bg-2">
    <CustomIcon name="three-dots" className="w-6 h-6 text-3" />
  </div>
)

function ModelingArea() {
  const authToken = useToken()
  const boundingRef = useRef<HTMLDivElement>(null)
  return (
    <div
      ref={boundingRef}
      className="relative z-0 min-w-64 flex flex-col flex-1 items-center overflow-hidden"
    >
      <Toolbar />
      <ConnectionStream authToken={authToken} />
      <Draggable
        containerRef={boundingRef}
        Handle={<Handle />}
        className="self-end relative z-50 pointer-events-auto w-full max-w-sm m-4 border b-5 rounded shadow-lg bg-chalkboard-10 dark:bg-chalkboard-100 dark:border-chalkboard-70"
      >
        <p className="m-2">This is a draggable box</p>
      </Draggable>
      <div className="absolute bottom-2 right-2 flex flex-col items-end gap-3 pointer-events-none">
        <Gizmo />
      </div>
    </div>
  )
}

/**
 * For now we have strict area types but in future
 * we should make it possible to register your own in an extension.
 */
export const defaultAreaLibrary = Object.freeze({
  featureTree: {
    hide: () => false,
    shortcut: 'Shift + T',
    Component: FeatureTreePane,
  },
  modeling: {
    hide: () => false,
    Component: ModelingArea,
  },
  ttc: {
    hide: () => false,
    shortcut: 'Ctrl + T',
    cssClassOverrides: {
      button:
        'bg-ml-green pressed:bg-transparent dark:!text-chalkboard-100 hover:dark:!text-inherit dark:pressed:!text-inherit',
    },
    Component: MlEphantConversationPaneWrapper,
  },
  codeEditor: {
    hide: () => false,
    shortcut: 'Shift + C',
    Component: KclEditorPane,
    useNotifications() {
      const value = kclManager.diagnosticsSignal.value.filter(
        (diagnostic) => diagnostic.severity === 'error'
      ).length
      return useMemo(() => {
        return { value, onClick: onCodeNotificationClick, title: undefined }
      }, [value])
    },
  },
  files: {
    hide: () => !isDesktop(),
    shortcut: 'Shift + F',
    Component: ProjectExplorerPane,
    useNotifications() {
      const title = 'Project files have runtime errors'
      // Only compute runtime errors! Compilation errors are not tracked here.
      const errors = kclErrorsByFilename(kclManager.errorsSignal.value)
      const value = errors.size > 0 ? 'x' : ''
      const onClick: MouseEventHandler = (e) => {
        e.preventDefault()
        // TODO: When we have generic file open
        // If badge is pressed
        // Open the first error in the array of errors
        // Then scroll to error
        // Do you automatically open the project files
        // kclManager.scrollToFirstErrorDiagnosticIfExists()
      }
      return useMemo(() => ({ value, onClick, title }), [value, title])
    },
  },
  variables: {
    hide: () => false,
    shortcut: 'Shift + V',
    Component: MemoryPane,
  },
  logs: {
    hide: () => false,
    shortcut: 'Shift + L',
    Component: LogsPane,
  },
  debug: {
    hide: () => getSettings().app.showDebugPanel.current === false,
    shortcut: 'Shift + D',
    Component: DebugPane,
  },
} satisfies Record<AreaType, AreaTypeDefinition>)

function testArea(name: string): AreaTypeDefinition {
  return {
    hide: () => false,
    Component: () => (
      <div className="self-stretch flex-1 grid place-content-center">
        {name}
      </div>
    ),
  }
}

export const testAreaLibrary = Object.freeze({
  featureTree: testArea('Feature Tree'),
  modeling: testArea('Modeling Scene'),
  ttc: testArea('TTC'),
  codeEditor: testArea('Code Editor'),
  files: testArea('File Explorer'),
  logs: testArea('Logs'),
  variables: testArea('Variables'),
  debug: testArea('Debug'),
} satisfies Record<AreaType, AreaTypeDefinition>)
