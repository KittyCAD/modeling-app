import { getDesktopRendererPath } from '@src/lib/desktopProtocol'
import {
  duplicateViewOnlyProject,
  getDesktopProjectUrl,
} from '@src/lib/projectSharing'
import type { App } from '@src/lib/app'
import type { Project } from '@src/lib/project'
import fsZds from '@src/lib/fs-zds'
import { posix } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('@src/lib/cloudSync/localManifest', () => ({
  collectLocalProjectFilesForCloudSync: vi.fn(async () => [
    {
      relativePath: 'main.kcl',
      data: new TextEncoder().encode('@settings(kclVersion = 3.0)\nx = 1\n'),
    },
  ]),
}))

afterEach(() => vi.restoreAllMocks())

test.each(['parts/bracket.kcl', 'parts/a=b.kcl', 'parts/a%2Fb#?.kcl'])(
  'desktop handoff preserves the selected file: %s',
  (file) => {
    vi.spyOn(fsZds, 'relative').mockImplementation((from, to) =>
      posix.relative(from, to)
    )
    const project = {
      path: '/private-cache/snapshot',
      cloudSource: { id: 'project-id', canEdit: false, kind: 'public' },
    } as Project
    const link = getDesktopProjectUrl(
      project,
      `/private-cache/snapshot/${file}`
    )
    if (!link) throw new Error('Missing desktop project URL')
    const route = new URL(getDesktopRendererPath(link), 'https://app.zoo.dev/')
    expect(route.pathname).toBe('/project/project-id')
    expect(route.searchParams.get('file')).toBe(file)
  }
)

test('cloud projects opened from a library share the same project URL', () => {
  vi.spyOn(fsZds, 'relative').mockImplementation((from, to) =>
    posix.relative(from, to)
  )
  const project = {
    path: '/projects/owned',
    cloudProjectId: 'project-id',
  } as Project
  expect(getDesktopProjectUrl(project, '/projects/owned/main.kcl')).toBe(
    'zoo-studio://project/project-id?file=main.kcl'
  )
})

test('legacy create-file links retain base64 padding', () => {
  const route = new URL(
    getDesktopRendererPath('zoo-studio:///?create-file&code=YQ%3D%3D'),
    'https://app.zoo.dev/'
  )
  expect(route.searchParams.get('code')).toBe('YQ==')
})

test('does not navigate to a copy after switching projects during its upload', async () => {
  vi.spyOn(fsZds, 'relative').mockImplementation((from, to) =>
    posix.relative(from, to)
  )
  vi.spyOn(fsZds, 'join').mockImplementation((...paths) => posix.join(...paths))
  const session = {
    projectIORefSignal: {
      value: {
        path: '/snapshot',
        name: 'source',
        default_file: '/snapshot/main.kcl',
        cloudSource: { id: 'source', canEdit: false, kind: 'public' },
      },
    },
    executingPath: '/snapshot/main.kcl',
  }
  let finishSync!: (url: string) => void
  const syncing = new Promise<string>((resolve) => {
    finishSync = resolve
  })
  const navigate = vi.fn()
  const app = {
    project: session,
    fileOperations: {},
    getCreateProjectLibraryTargets: () => [
      {
        library: { id: 'cloud', title: 'Cloud', type: 'cloud', path: '/cloud' },
        createProject: {
          run: async () => ({
            path: '/cloud/copy',
            default_file: '/cloud/copy/main.kcl',
          }),
        },
      },
    ],
    getProjectUrl: vi.fn(() => syncing),
    registry: { get: () => ({ navigate }) },
  }
  const copying = duplicateViewOnlyProject(app as unknown as App)
  await vi.waitFor(() => expect(app.getProjectUrl).toHaveBeenCalledOnce())
  app.project = { ...session, executingPath: '/another/main.kcl' }
  finishSync('/project/copy?file=main.kcl')
  await copying
  expect(navigate).not.toHaveBeenCalled()
})
