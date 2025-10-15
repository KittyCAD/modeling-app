import { useSearchParams } from 'react-router-dom'
import { useToken } from '@src/lib/singletons'
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
import type { Closeable } from '@src/lib/layout/types'
import { isDesktop } from '@src/lib/isDesktop'

export type AreaTypeDefinition = {
  useHidden: () => boolean
  shortcut?: string
  Component: (props: Partial<Closeable>) => React.ReactElement
}

/**
 * For now we have strict area types but in future
 * we should make it possible to register your own in an extension.
 */
export const areaTypeRegistry = Object.freeze({
  featureTree: {
    useHidden: () => false,
    shortcut: 'Shift + T',
    Component: (props: Partial<Closeable>) =>
      PaneToArea({ pane: sidebarPanesLeft[0], ...props }),
  },
  modeling: {
    useHidden: () => false,
    Component: ModelingArea,
  },
  ttc: {
    useHidden: () => false,
    shortcut: 'Ctrl + T',
    Component: (props: Partial<Closeable>) =>
      PaneToArea({ pane: sidebarPanesRight[0], ...props }),
  },
  codeEditor: {
    useHidden: () => false,
    shortcut: 'Shift + C',
    Component: (props: Partial<Closeable>) =>
      PaneToArea({ pane: sidebarPanesLeft[1], ...props }),
  },
  files: {
    useHidden: () => !isDesktop(),
    shortcut: 'Shift + F',
    Component: (props: Partial<Closeable>) =>
      PaneToArea({ pane: sidebarPanesLeft[2], ...props }),
  },
  variables: {
    useHidden: () => false,
    shortcut: 'Shift + V',
    Component: (props: Partial<Closeable>) =>
      PaneToArea({ pane: sidebarPanesLeft[3], ...props }),
  },
  logs: {
    useHidden: () => false,
    shortcut: 'Shift + L',
    Component: (props: Partial<Closeable>) =>
      PaneToArea({ pane: sidebarPanesLeft[4], ...props }),
  },
  debug: {
    useHidden: () => false,
    shortcut: 'Shift + D',
    Component: (props: Partial<Closeable>) =>
      PaneToArea({ pane: sidebarPanesLeft[5], ...props }),
  },
} satisfies Record<string, AreaTypeDefinition>)

function TestArea({ name }: { name: string }) {
  return (
    <div className="self-stretch flex-1 grid place-content-center">{name}</div>
  )
}

export const testAreaTypeRegistry = Object.freeze({
  featureTree: () => <TestArea name="featureTree" />,
  modeling: () => <TestArea name="featureTree" />,
  ttc: () => <TestArea name="ttc" />,
  codeEditor: () => <TestArea name="codeEditor" />,
  files: () => <TestArea name="files" />,
  logs: () => <TestArea name="logs" />,
  variables: () => <TestArea name="variables" />,
  debug: () => <TestArea name="debug" />,
} satisfies Record<
  keyof typeof areaTypeRegistry,
  (props: Partial<Closeable>) => JSX.Element
>)

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
