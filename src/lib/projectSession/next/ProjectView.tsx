import { useSignals } from '@preact/signals-react/runtime'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { Logo } from '@src/components/Logo'
import type { StatusBarItemType } from '@src/components/StatusBar/statusBarTypes'
import { StatusBar } from '@src/components/StatusBar/StatusBar'
import { useApp } from '@src/lib/boot'
import { EditorsPane } from '@src/lib/editors/EditorsPane'
import { OPEN_EDITOR_COMMAND } from '@src/lib/editors/commands'
import {
  editorTabIndicatorValueSpec,
  editorsService,
} from '@src/lib/editors/registry/contract'
import { ExecutorArea } from '@src/lib/executors/ExecutorArea'
import { LayoutRootNode } from '@src/lib/layout/components'
import {
  LayoutType,
  type AreaLibrary,
  type AreaTypeComponentProps,
  type Layout,
} from '@src/lib/layout/types'
import { PATHS } from '@src/lib/paths'
import type { OpenProjectSession } from '@src/lib/projectSession/next/contract'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

/**
 * Just a temp layout while we build up parity with the old one.
 */
const tempLayout: Layout = {
  id: 'next',
  label: 'Project',
  type: LayoutType.Splits,
  orientation: 'inline',
  sizes: [50, 50],
  children: [
    {
      id: 'next-sidebar',
      label: 'Sidebar',
      type: LayoutType.Panes,
      side: 'inline-start',
      splitOrientation: 'block',
      sizes: [],
      activeIndices: [],
      children: [
        {
          id: 'next-editors',
          label: 'Editors',
          icon: 'code',
          type: LayoutType.Simple,
          areaType: 'editors',
        },
      ],
    },
    {
      id: 'next-modeling',
      label: 'Modeling',
      type: LayoutType.Simple,
      areaType: 'modeling',
    },
  ],
}

function ProjectFilesPane({
  session,
  layout,
  onClose,
}: AreaTypeComponentProps & { session: OpenProjectSession }) {
  useSignals()
  const { children } = session.project.value.contents
  return (
    <LayoutPanel id={layout.id} title={layout.label} className="min-h-0">
      <LayoutPanelHeader
        id={layout.id}
        title={layout.label}
        icon="folder"
        onClose={onClose}
      />
      <div className="min-h-0 overflow-auto p-3 text-sm">
        {children.length === 0 ? (
          <p>No files in this project.</p>
        ) : (
          <ul className="space-y-1">
            {children.map((entry) => (
              <li key={entry.path} className="break-words">
                {entry.name}
                {entry.children !== null ? '/' : ''}
              </li>
            ))}
          </ul>
        )}
      </div>
    </LayoutPanel>
  )
}

/** Minimal project chrome while the new route takes shape. */
function ProjectHeader({ title }: { title: string }) {
  return (
    <header
      className={`flex shrink-0 select-none items-center gap-3 border-b border-chalkboard-30 py-2 [-webkit-app-region:drag] dark:border-chalkboard-70 ${window.electron?.os.isMac ? 'pl-24 pr-3' : 'px-3'}`}
    >
      <Link to={PATHS.HOME} aria-label="Projects">
        <Logo className="h-4 w-auto" />
      </Link>
      <h1 className="truncate text-sm font-semibold">{title}</h1>
    </header>
  )
}

/** Show the captured project without legacy modeling providers. */
export function ProjectView({ session }: { session: OpenProjectSession }) {
  useSignals()
  const { registry, commands } = useApp()
  const editors = registry.get(editorsService)
  const { contents, metadata } = session.project.value
  const [layout, setLayout] = useState(() => structuredClone(tempLayout))
  const areaLibrary = useMemo<AreaLibrary>(
    () => ({
      files: {
        hide: () => false,
        Component: (props) => <ProjectFilesPane {...props} session={session} />,
      },
      editors: {
        hide: () => false,
        Component: (props) => (
          <EditorsPane
            {...props}
            editors={editors}
            indicators={registry.signal(editorTabIndicatorValueSpec)}
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
      modeling: { hide: () => false, Component: ExecutorArea },
    }),
    [session, editors, commands, registry]
  )
  return (
    <div className="flex h-screen flex-col bg-chalkboard-10 text-chalkboard-100 dark:bg-chalkboard-100 dark:text-chalkboard-10">
      <ProjectHeader title={metadata.title} />
      <div className="min-h-0 flex-1">
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
      </div>
      <StatusBar
        globalItems={[
          {
            id: 'project-path',
            element: 'text',
            label: contents.path,
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
