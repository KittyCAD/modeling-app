import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type * as desktop from '@src/lib/desktop'
import { act, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  projectPath: '',
  project: {
    projectIORefSignal: { value: { path: '' } },
    executingFileEntry: { value: undefined },
  },
  send: vi.fn(),
  watch: vi.fn(),
}))

vi.mock('@src/lib/boot', () => {
  const app = {
    settings: { actor: { send: mocks.send } },
    get project() {
      return mocks.project
    },
  }
  return {
    useApp: () => app,
    useSingletons: () => ({
      kclManager: { livePathsToWatch: { value: [] } },
    }),
  }
})
vi.mock('@src/lib/desktop', async (importOriginal) => ({
  ...(await importOriginal<typeof desktop>()),
  getAppSettingsFilePath: async () => '/settings.toml',
}))
vi.mock('@src/hooks/useAuthNavigation', () => ({
  useAuthNavigation: () => {},
}))
vi.mock('@src/hooks/useFileSystemWatcher', () => ({
  useFileSystemWatcher: mocks.watch,
}))
vi.mock('@src/components/SessionExpiredDialog', () => ({
  SessionExpiredDialogHost: () => null,
}))

import { RouteProvider } from '@src/components/RouteProvider'
import fsZds from '@src/lib/fs-zds'
import { PATHS } from '@src/lib/paths'

let directory: string
let router: ReturnType<typeof createMemoryRouter> | undefined

beforeEach(async () => {
  vi.clearAllMocks()
  directory = await mkdtemp(join(tmpdir(), 'route-provider-deletion-'))
  mocks.projectPath = join(directory, 'project')
  mocks.project = {
    projectIORefSignal: { value: { path: mocks.projectPath } },
    executingFileEntry: { value: undefined },
  }
  await mkdir(mocks.projectPath)
  vi.spyOn(fsZds, 'stat').mockImplementation(stat)
})

afterEach(async () => {
  router?.dispose()
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})

async function openProject() {
  router = createMemoryRouter(
    [
      {
        path: '/project',
        element: (
          <RouteProvider>
            <h1>Opened project</h1>
          </RouteProvider>
        ),
      },
      { path: PATHS.HOME, element: <h1>Projects home</h1> },
      { path: '/other', element: <h1>Other project</h1> },
    ],
    { initialEntries: ['/project'] }
  )
  render(<RouterProvider router={router} />)
  expect(await screen.findByRole('heading')).toHaveTextContent('Opened project')
  const registration = mocks.watch.mock.calls.find(([, paths]) =>
    paths.includes(mocks.projectPath)
  )
  expect(registration).toBeDefined()
  return registration?.[0] as (event: string, path: string) => Promise<void>
}

describe('opened project settings watcher', () => {
  it.each(['node', 'electron'] as const)(
    'returns home when a deleted directory rejects stat (%s)',
    async (runtime) => {
      if (runtime === 'electron') {
        vi.mocked(fsZds.stat).mockImplementation((path) =>
          stat(path).catch((error: NodeJS.ErrnoException) =>
            Promise.reject(error.code)
          )
        )
      }
      const onChange = await openProject()
      await rm(mocks.projectPath, { recursive: true })

      await act(async () => {
        await onChange('unlinkDir', mocks.projectPath)
      })

      expect(screen.getByRole('heading')).toHaveTextContent('Projects home')
      expect(mocks.send).not.toHaveBeenCalled()
    }
  )

  it('reloads settings for a change while the project still exists', async () => {
    const onChange = await openProject()
    await act(async () => {
      await onChange('change', '/settings.toml')
    })
    expect(screen.getByRole('heading')).toHaveTextContent('Opened project')
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith({
      type: 'reload.settings',
    })
  })

  it('ignores non-change events while the project still exists', async () => {
    const onChange = await openProject()
    await act(async () => {
      await onChange('add', mocks.projectPath)
    })
    expect(screen.getByRole('heading')).toHaveTextContent('Opened project')
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('preserves permission failures for the watcher error handler', async () => {
    const onChange = await openProject()
    const error = Object.assign(new Error('Permission denied'), {
      code: 'EACCES',
    })
    vi.mocked(fsZds.stat).mockRejectedValueOnce(error)
    await expect(onChange('change', '/settings.toml')).rejects.toBe(error)
    expect(screen.getByRole('heading')).toHaveTextContent('Opened project')
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('ignores a deleted-project result after opening another project', async () => {
    const onChange = await openProject()
    let reportMissing = () => {}
    vi.mocked(fsZds.stat).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          reportMissing = () => reject('ENOENT')
        })
    )
    const pendingChange = onChange('unlinkDir', mocks.projectPath)
    mocks.project = {
      projectIORefSignal: { value: { path: join(directory, 'other') } },
      executingFileEntry: { value: undefined },
    }
    await act(async () => {
      await router?.navigate('/other')
      reportMissing()
      await pendingChange
    })
    expect(screen.getByRole('heading')).toHaveTextContent('Other project')
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
