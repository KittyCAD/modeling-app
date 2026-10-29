import { getDesktopRendererPath } from '@src/lib/desktopProtocol'
import { getDesktopProjectUrl } from '@src/lib/projectSharing'
import type { Project } from '@src/lib/project'
import fsZds from '@src/lib/fs-zds'
import { posix } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'

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
