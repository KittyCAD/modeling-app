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

/**
 * For now we have strict area types but in future
 * we should make it possible to register your own in an extension.
 */
export const areaTypeRegistry = Object.freeze({
  featureTree: (props: Partial<Closeable>) =>
    PaneToArea({ pane: sidebarPanesLeft[0], ...props }),
  modeling: ModelingArea,
  ttc: (props: Partial<Closeable>) =>
    PaneToArea({ pane: sidebarPanesRight[0], ...props }),
  variables: (props: Partial<Closeable>) =>
    PaneToArea({ pane: sidebarPanesLeft[3], ...props }),
  codeEditor: (props: Partial<Closeable>) =>
    PaneToArea({ pane: sidebarPanesLeft[1], ...props }),
  logs: (props: Partial<Closeable>) =>
    PaneToArea({ pane: sidebarPanesLeft[4], ...props }),
})

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
  logs: () => <TestArea name="logs" />,
  variables: () => <TestArea name="variables" />,
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
