import { getDesktopProjectUrl } from '@src/lib/projectSharing'
import type { Project } from '@src/lib/project'
import fsZds from '@src/lib/fs-zds'
import { posix } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => vi.restoreAllMocks())

test('desktop handoff keeps the cloud identity and selected relative file', () => {
  vi.spyOn(fsZds, 'relative').mockImplementation((from, to) =>
    posix.relative(from, to)
  )
  const project = {
    path: '/private-cache/snapshot',
    cloudSource: { id: 'project-id', canEdit: false, kind: 'public' },
  } as Project
  expect(
    getDesktopProjectUrl(project, '/private-cache/snapshot/parts/bracket.kcl')
  ).toBe('zoo-studio://project/project-id?file=parts%2Fbracket.kcl')
})

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
