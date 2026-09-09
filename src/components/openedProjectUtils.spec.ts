import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  checkOpenedProjectPresence,
  getZookeeperProjectReloadBehavior,
} from '@src/components/openedProjectUtils'
import fsZds, { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'

beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('opened project presence', () => {
  it('keeps an existing project when a failed refresh publishes an empty folder list', async () => {
    const projectPath = `/tmp/opened-project-${crypto.randomUUID()}`
    await fsZds.mkdir(projectPath, { recursive: true })

    try {
      expect(
        await checkOpenedProjectPresence({
          projectPath,
          projects: [],
        })
      ).toEqual({ type: 'present' })
    } finally {
      await fsZds.rm(projectPath, { recursive: true, force: true })
    }
  })

  it('detects when the opened project directory was removed', async () => {
    const projectPath = `/tmp/missing-opened-project-${crypto.randomUUID()}`

    await expect(
      checkOpenedProjectPresence({ projectPath, projects: [] })
    ).resolves.toEqual({ type: 'missing' })
  })

  it('keeps the opened project when the refreshed paths match', async () => {
    const stat = vi.spyOn(fsZds, 'stat')

    await expect(
      checkOpenedProjectPresence({
        projectPath: '/Users/max/Repos',
        projects: [{ path: '/Users/max/Repos/' }],
      })
    ).resolves.toEqual({ type: 'present' })
    expect(stat).not.toHaveBeenCalled()
  })

  it('does not treat other filesystem errors as project removal', async () => {
    const error = Object.assign(new Error('EACCES'), { code: 'EACCES' })
    vi.spyOn(fsZds, 'stat').mockRejectedValueOnce(error)

    await expect(
      checkOpenedProjectPresence({
        projectPath: '/Users/max/Repos',
        projects: [],
      })
    ).resolves.toEqual({ type: 'error', error })
  })
})

describe('getZookeeperProjectReloadBehavior', () => {
  it('exits sketch solve mode before reloading zookeeper edits', () => {
    expect(
      getZookeeperProjectReloadBehavior({
        matches: (value) => value === 'sketchSolveMode',
      })
    ).toBe('exit-sketch-solve')
  })

  it('skips the forced camera reset in legacy sketch mode', () => {
    expect(
      getZookeeperProjectReloadBehavior({
        matches: (value) => value === 'Sketch',
      })
    ).toBe('execute-without-camera-reset')
  })

  it('keeps the current behavior outside sketch mode', () => {
    expect(
      getZookeeperProjectReloadBehavior({
        matches: () => false,
      })
    ).toBe('execute-and-reset-camera')
  })
})
