import { useSignals } from '@preact/signals-react/runtime'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { Logo } from '@src/components/Logo'
import type { StatusBarItemType } from '@src/components/StatusBar/statusBarTypes'
import { StatusBar } from '@src/components/StatusBar/StatusBar'
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
 * Use the shared pane renderer with data-only areas. Pane changes stay local to this
 * screen instead of changing the saved layout used by the modeling route.
 */
const tempLayout: Layout = {
  id: 'next-project',
  label: 'Project',
  type: LayoutType.Splits,
  orientation: 'inline',
  sizes: [25, 75],
  children: [
    {
      id: 'next-sidebar',
      label: 'Sidebar',
      type: LayoutType.Panes,
      side: 'inline-start',
      splitOrientation: 'block',
      sizes: [100],
      activeIndices: [0],
      children: [
        {
          id: 'next-files',
          label: 'Project files',
          icon: 'folder',
          type: LayoutType.Simple,
          areaType: 'files',
        },
      ],
    },
    {
      id: 'next-workspace',
      label: 'Workspace',
      type: LayoutType.Simple,
      areaType: 'workspace',
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

function EmptyWorkspace() {
  return (
    <main className="grid min-w-0 flex-1 place-content-center gap-2 p-6 text-center">
      <h2 className="text-lg font-semibold">Project open</h2>
      <p>No editor is executing for this project.</p>
    </main>
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

/** Compose the shared app shell around a captured project, without editor providers. */
export function ProjectView({ session }: { session: OpenProjectSession }) {
  useSignals()
  const { contents, metadata } = session.project.value
  const [layout, setLayout] = useState(() => structuredClone(tempLayout))
  const areaLibrary = useMemo<AreaLibrary>(
    () => ({
      files: {
        hide: () => false,
        Component: (props) => <ProjectFilesPane {...props} session={session} />,
      },
      workspace: { hide: () => false, Component: EmptyWorkspace },
    }),
    [session]
  )
  return (
    <div className="flex h-screen flex-col bg-chalkboard-10 text-chalkboard-100 dark:bg-chalkboard-100 dark:text-chalkboard-10">
      <ProjectHeader title={metadata.title} />
      <div className="min-h-0 flex-1">
        <LayoutRootNode
          layout={layout}
          getLayout={() => layout}
          setLayout={setLayout}
          layoutName="next-project"
          areaLibrary={areaLibrary}
          showDebugPanel={false}
          notifications={[]}
          artifactGraph={new Map()}
        />
      </div>
      <StatusBar
        globalItems={[
          {
            id: 'next-project-path',
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
                  id: 'next-read-only',
                  element: 'text',
                  label: 'Read-only',
                } satisfies StatusBarItemType,
              ]
            : []),
          {
            id: 'next-no-editor',
            element: 'text',
            label: 'No executing editor',
          },
        ]}
      />
    </div>
  )
}
