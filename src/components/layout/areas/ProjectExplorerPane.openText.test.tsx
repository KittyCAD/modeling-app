import type { ProjectExplorer } from '@src/components/Explorer/ProjectExplorer'
import type { FileExplorerEntry } from '@src/components/Explorer/utils'
import { LayoutType } from '@src/lib/layout/types'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps, PropsWithChildren } from 'react'
import { Suspense } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openText: vi.fn().mockResolvedValue(undefined),
  clearText: vi.fn(),
  send: vi.fn(),
  fileOperations: {},
  wasm: Promise.resolve({}),
  flushKcl: vi.fn().mockResolvedValue(true),
}))

vi.mock('@src/lib/boot', () => {
  const app = {
    commands: { send: vi.fn() },
    fileOperations: mocks.fileOperations,
    systemIOActor: { send: mocks.send },
    layout: { get: () => ({}), set: vi.fn() },
    project: {
      projectIORefSignal: {
        value: { name: 'demo', path: '/projects/demo', children: [] },
      },
      executingFileEntry: { value: { path: '/projects/demo/main.kcl' } },
    },
  }
  const singletons = {
    kclManager: {
      wasmInstancePromise: mocks.wasm,
      flushWriteToFile: mocks.flushKcl,
    },
  }
  return { useApp: () => app, useSingletons: () => singletons }
})
vi.mock('@src/lib/activeTextFile', () => ({
  openActiveTextFile: mocks.openText,
  clearActiveTextFile: mocks.clearText,
}))
vi.mock('@src/lang/wasmUtils', () => ({
  importFileExtensions: () => ['step', 'obj', 'stl'],
}))
vi.mock('@src/hooks/useModelingContext', () => ({
  useModelingContext: () => ({ state: { matches: () => false } }),
}))
vi.mock('@src/machines/systemIO/hooks', () => ({
  useFolders: () => undefined,
  useProjectDirectoryPath: () => '/projects',
}))
vi.mock('@src/machines/systemIO/utils', () => ({
  SystemIOMachineEvents: {
    readFoldersFromProjectDirectory: 'readFolders',
    navigateToFile: 'navigateToFile',
  },
}))
vi.mock('@src/lib/layout', () => ({
  DefaultLayoutPaneID: { Code: 'code' },
  getOpenPanes: () => ['code'],
  togglePaneLayoutNode: vi.fn(),
}))
vi.mock('@src/components/layout/Panel', () => ({
  LayoutPanel: ({ children }: PropsWithChildren) => <div>{children}</div>,
  LayoutPanelHeader: () => null,
}))
vi.mock('@src/components/Explorer/FileExplorerHeaderActions', () => ({
  FileExplorerHeaderActions: () => null,
}))
vi.mock('@src/components/Explorer/ProjectExplorer', () => ({
  ProjectExplorer: (props: ComponentProps<typeof ProjectExplorer>) => (
    <>
      {[
        'config.json',
        'nested/tool.yaml',
        'LICENSE',
        'part.STEP',
        'mesh.obj',
        'main.kcl',
      ].map((name) => {
        const entry: FileExplorerEntry = {
          name,
          path: `/projects/demo/${name}`,
          children: null,
          parentPath: '/projects/demo',
          level: 0,
          index: 0,
          key: name,
          setSize: 6,
        }
        return (
          <button
            key={name}
            onClick={() => props.onRowClicked(entry, 0)}
            onKeyDown={() => props.onRowEnter(entry, 0)}
          >
            {name}
          </button>
        )
      })}
      <button onClick={() => props.onOpenAsText?.('/projects/demo/part.STEP')}>
        Open STEP as Text
      </button>
    </>
  ),
}))

import { ProjectExplorerPane } from '@src/components/layout/areas/ProjectExplorerPane'

async function renderExplorer() {
  await act(async () => {
    render(
      <Suspense>
        <ProjectExplorerPane
          areaConfig={{ hide: () => false }}
          layout={{
            type: LayoutType.Simple,
            id: 'files',
            label: 'Files',
            areaType: 'files',
          }}
        />
      </Suspense>
    )
  })
}

describe('opening project text files', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(['config.json', 'nested/tool.yaml', 'LICENSE'])(
    'opens %s on click and Enter',
    async (name) => {
      await renderExplorer()
      const row = screen.getByRole('button', { name })
      fireEvent.click(row)
      expect(mocks.openText).toHaveBeenLastCalledWith(
        mocks.fileOperations,
        `/projects/demo/${name}`
      )
      fireEvent.keyDown(row, { key: 'Enter' })
      expect(mocks.openText).toHaveBeenCalledTimes(2)
    }
  )

  it('keeps CAD clicks separate from explicitly opening as text', async () => {
    await renderExplorer()
    fireEvent.click(screen.getByRole('button', { name: 'part.STEP' }))
    fireEvent.click(screen.getByRole('button', { name: 'mesh.obj' }))
    expect(mocks.openText).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Open STEP as Text' }))
    expect(mocks.openText).toHaveBeenCalledWith(
      mocks.fileOperations,
      '/projects/demo/part.STEP'
    )
  })

  it('keeps KCL on the modeling path', async () => {
    await renderExplorer()
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'main.kcl' }))
    )
    expect(mocks.openText).not.toHaveBeenCalled()
    expect(mocks.clearText).toHaveBeenCalled()
    expect(mocks.flushKcl).toHaveBeenCalled()
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'navigateToFile' })
    )
  })
})
