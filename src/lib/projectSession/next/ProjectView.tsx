import { appHeaderItemsValueSpec } from '@src/registry/contracts/appHeader'
import { reportRejection } from '@src/lib/trap'
import { useSignals } from '@preact/signals-react/runtime'
import { Logo } from '@src/components/Logo'
import type { StatusBarItemType } from '@src/components/StatusBar/statusBarTypes'
import { StatusBar } from '@src/components/StatusBar/StatusBar'
import { useApp } from '@src/lib/boot'
import { EditorsPane } from '@src/lib/editors/EditorsPane'
import { OPEN_EDITOR_COMMAND } from '@src/lib/editors/commands'
import {
  editorTabIndicatorsValueSpec,
  editorsService,
} from '@src/lib/editors/registry/contract'
import { LayoutRootNode } from '@src/lib/layout/components'
import {
  LayoutType,
  type AreaLibrary,
  type Layout,
} from '@src/lib/layout/types'
import { PATHS } from '@src/lib/paths'
import type { OpenProjectSession } from '@src/lib/projectSession/next/contract'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

/**
 * Just a temp layout while we build up parity with the old one.
 */
const tempLayout: Layout = {
  id: 'next-editors',
  label: 'Editors',
  type: LayoutType.Simple,
  areaType: 'editors',
}

/** Minimal project chrome while the new route takes shape. */
function ProjectHeader({ title }: { title: string }) {
  useSignals()
  const app = useApp()
  const items = app.registry.signal(appHeaderItemsValueSpec).value
  return (
    <header
      className={`flex shrink-0 select-none items-center gap-3 border-b b-4 py-2 [-webkit-app-region:drag] ${window.electron?.os.isMac ? 'pl-24 pr-3' : 'px-3'}`}
    >
      <Link to={PATHS.HOME} aria-label="Projects">
        <Logo className="h-4 w-auto" />
      </Link>
      <h1 className="truncate text-sm font-semibold">{title}</h1>
      <div className="ml-auto flex shrink-0 items-center gap-2 [-webkit-app-region:no-drag]">
        {items.map(({ id, Component }) => (
          <Component
            key={id}
            app={app}
            className="inline-flex h-6 items-center gap-1.5 rounded border b-4 bg-2 px-2 text-xs text-default"
          />
        ))}
      </div>
    </header>
  )
}

/** Show the captured project without legacy modeling providers. */
export function ProjectView({ session }: { session: OpenProjectSession }) {
  useSignals()
  const { registry, commands } = useApp()
  useEffect(() => {
    void window.electron?.createEditorPageMenu?.().catch(reportRejection)
  }, [])
  const editors = registry.get(editorsService)
  const { contents, metadata } = session.project.value
  const [layout, setLayout] = useState(() => structuredClone(tempLayout))
  const areaLibrary = useMemo<AreaLibrary>(
    () => ({
      editors: {
        hide: () => false,
        Component: (props) => (
          <EditorsPane
            {...props}
            editors={editors}
            indicators={registry.signal(editorTabIndicatorsValueSpec)}
            onOpenEditor={() =>
              commands.send({
                type: 'Find and select command',
                data: {
                  name: OPEN_EDITOR_COMMAND.name,
                  groupId: OPEN_EDITOR_COMMAND.groupId,
                },
              })
            }
          />
        ),
      },
    }),
    [editors, commands, registry]
  )
  return (
    <div className="flex h-screen flex-col bg-default text-default">
      <ProjectHeader title={metadata.title} />
      <main aria-label="Editor views" className="flex min-h-0 flex-1 flex-col">
        <LayoutRootNode
          layout={layout}
          getLayout={() => layout}
          setLayout={setLayout}
          layoutName="next"
          areaLibrary={areaLibrary}
          showDebugPanel={false}
          notifications={[]}
          artifactGraph={new Map()}
        />
      </main>
      <StatusBar
        globalItems={[
          {
            id: 'project-path',
            element: 'text',
            label: session.project.value.storage
              ? 'Personal Cloud'
              : contents.path,
            className: 'max-w-[50vw] [&>span]:truncate',
            toolTip: { children: contents.path },
          },
        ]}
        localItems={[
          ...(!metadata.readWriteAccess
            ? [
                {
                  id: 'read-only',
                  element: 'text',
                  label: 'Read-only',
                } satisfies StatusBarItemType,
              ]
            : []),
        ]}
      />
    </div>
  )
}
