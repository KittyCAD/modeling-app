import { useSearchParams } from 'react-router-dom'
import {
  editorManager,
  getLayout,
  getSettings,
  setLayout,
  useToken,
} from '@src/lib/singletons'
import env from '@src/env'
import { ConnectionStream } from '@src/components/ConnectionStream'
import Gizmo from '@src/components/gizmo/Gizmo'
import { UnitsMenu } from '@src/components/UnitsMenu'
import { Toolbar } from '@src/Toolbar'
import type { AreaType, AreaTypeDefinition } from '@src/lib/layout/types'
import { isDesktop } from '@src/lib/isDesktop'
import { useKclContext } from '@src/lang/KclProvider'
import { kclErrorsByFilename } from '@src/lang/errors'
import type { MouseEventHandler } from 'react'
import { useMemo } from 'react'
import { togglePaneLayoutNode } from '@src/lib/layout/utils'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'
import { ExperimentalFeaturesMenu } from '@src/components/ExperimentalFeaturesMenu'
import { ProjectExplorerPane } from '@src/components/layout/areas/ProjectExplorerPane'
import { KclEditorPane } from '@src/components/layout/areas/KclEditorPane'
import { MlEphantConversationPaneWrapper } from '@src/components/layout/areas/MlEphantConversationPaneWrapper'
import { FeatureTreePane } from '@src/components/layout/areas/FeatureTreePane'
import { MemoryPane } from '@src/components/layout/areas/MemoryPane'
import { LogsPane } from '@src/components/layout/areas/LoggingPanes'
import { DebugPane } from '@src/components/layout/areas/DebugPane'

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
  editorManager.scrollToFirstErrorDiagnosticIfExists()
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
      const kclContext = useKclContext()
      const value = kclContext.diagnostics.filter(
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
      const kclContext = useKclContext()
      // Only compute runtime errors! Compilation errors are not tracked here.
      const errors = kclErrorsByFilename(kclContext.errors)
      const value = errors.size > 0 ? 'x' : ''
      const onClick: MouseEventHandler = (e) => {
        e.preventDefault()
        // TODO: When we have generic file open
        // If badge is pressed
        // Open the first error in the array of errors
        // Then scroll to error
        // Do you automatically open the project files
        // editorManager.scrollToFirstErrorDiagnosticIfExists()
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

function ModelingArea() {
  const authToken = useToken()

  // Stream related refs and data
  const [searchParams] = useSearchParams()
  const pool = searchParams?.get('pool') || env().POOL || null

  return (
    <div className="relative z-0 min-w-64 flex flex-col flex-1 items-center overflow-hidden">
      <Toolbar />
      <ConnectionStream pool={pool} authToken={authToken} />
      <div className="absolute bottom-2 right-2 flex flex-col items-end gap-3 pointer-events-none">
        <ExperimentalFeaturesMenu />
        <UnitsMenu />
        <Gizmo />
      </div>
    </div>
  )
}
