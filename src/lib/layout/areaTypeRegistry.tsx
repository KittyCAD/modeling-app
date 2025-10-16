import { useSearchParams } from 'react-router-dom'
import { editorManager, getLayout, useToken } from '@src/lib/singletons'
import env from '@src/env'
import { ConnectionStream } from '@src/components/ConnectionStream'
import Gizmo from '@src/components/Gizmo'
import { UnitsMenu } from '@src/components/UnitsMenu'
import { Toolbar } from '@src/Toolbar'
import {
  type SidebarPane,
  sidebarPanesLeft,
  sidebarPanesRight,
} from '@src/components/ModelingSidebar/ModelingPanes'
import { ModelingPane } from '@src/components/ModelingSidebar/ModelingPane'
import type {
  AreaType,
  AreaTypeDefinition,
  Closeable,
} from '@src/lib/layout/types'
import { isDesktop } from '@src/lib/isDesktop'
import { useKclContext } from '@src/lang/KclProvider'
import { kclErrorsByFilename } from '@src/lang/errors'
import type { MouseEventHandler } from 'react'
import {
  defaultLayout,
  getOpenPanes,
  setOpenPanes,
} from '@src/lib/layout/utils'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

/**
 * For now we have strict area types but in future
 * we should make it possible to register your own in an extension.
 */
export const areaTypeRegistry = Object.freeze({
  featureTree: {
    hide: () => false,
    shortcut: 'Shift + T',
    Component: (props: Partial<Closeable>) =>
      PaneToArea({ pane: sidebarPanesLeft[0], ...props }),
    useNotifications: () => undefined,
  },
  modeling: {
    hide: () => false,
    Component: ModelingArea,
    useNotifications: () => undefined,
  },
  ttc: {
    hide: () => false,
    shortcut: 'Ctrl + T',
    cssClassOverrides: {
      button:
        'bg-ml-green pressed:bg-transparent dark:!text-chalkboard-100 hover:dark:!text-inherit dark:pressed:!text-inherit',
    },
    Component: (props: Partial<Closeable>) =>
      PaneToArea({ pane: sidebarPanesRight[0], ...props }),
    useNotifications: () => undefined,
  },
  codeEditor: {
    hide: () => false,
    shortcut: 'Shift + C',
    Component: (props: Partial<Closeable>) =>
      PaneToArea({ pane: sidebarPanesLeft[1], ...props }),
    useNotifications() {
      const kclContext = useKclContext()
      const value = kclContext.diagnostics.filter(
        (diagnostic) => diagnostic.severity === 'error'
      ).length
      const onClick: MouseEventHandler = (e) => {
        e.preventDefault()
        setOpenPanes(
          getLayout() || defaultLayout,
          Array.from(new Set(getOpenPanes()).add(DefaultLayoutPaneID.Code))
        )
        editorManager.scrollToFirstErrorDiagnosticIfExists()
      }
      return { value, onClick, title: undefined }
    },
  },
  files: {
    hide: () => !isDesktop(),
    shortcut: 'Shift + F',
    Component: (props: Partial<Closeable>) =>
      PaneToArea({ pane: sidebarPanesLeft[2], ...props }),
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
      return { value, onClick, title }
    },
  },
  variables: {
    hide: () => false,
    shortcut: 'Shift + V',
    Component: (props: Partial<Closeable>) =>
      PaneToArea({ pane: sidebarPanesLeft[3], ...props }),
    useNotifications: () => undefined,
  },
  logs: {
    hide: () => false,
    shortcut: 'Shift + L',
    Component: (props: Partial<Closeable>) =>
      PaneToArea({ pane: sidebarPanesLeft[4], ...props }),
    useNotifications: () => undefined,
  },
  debug: {
    hide: () => false,
    shortcut: 'Shift + D',
    Component: (props: Partial<Closeable>) =>
      PaneToArea({ pane: sidebarPanesLeft[5], ...props }),
    useNotifications: () => undefined,
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

export const testAreaTypeRegistry = Object.freeze({
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
    <div className="relative z-0 flex flex-col flex-1 items-center overflow-hidden">
      <Toolbar />
      <ConnectionStream pool={pool} authToken={authToken} />
      <div className="absolute bottom-2 right-2 flex flex-col items-end gap-3 pointer-events-none">
        <UnitsMenu />
        <Gizmo />
      </div>
    </div>
  )
}

function PaneToArea({
  pane,
  onClose,
}: Partial<Closeable> & { pane: SidebarPane }) {
  const onCloseWithFallback =
    onClose || (() => console.warn('no onClose defined for', pane.id))
  return (
    <ModelingPane
      icon={pane.icon}
      title={pane.sidebarName}
      onClose={onCloseWithFallback}
      id={`${pane.id}-pane`}
      className="border-none"
    >
      {pane.Content({ id: pane.id, onClose: onCloseWithFallback })}
    </ModelingPane>
  )
}
