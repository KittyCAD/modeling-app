import { FileNotFound } from '@src/lib/fileSystem/fileOperations'
import type { ProjectStorage } from '@src/lib/projectSession/storage'
import { watchProjectStorage } from '@src/lib/projectSession/watchStorage'
import { PATHS } from '@src/lib/paths'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/wasm_lib_wrapper', () => ({}))

function setup(externalChanges: ProjectStorage['externalChanges'] = 'files') {
  let current = true
  let onEvent: (eventType: string, path: string) => void = () => {}
  const unwatch = vi.fn()
  const dependencies = {
    path: '/project',
    storage: {
      externalChanges,
      watch: vi.fn((_path: string, _key: string, callback: typeof onEvent) => {
        onEvent = callback
        return unwatch
      }),
    },
    isCurrent: () => current,
    fileOperations: { pending: vi.fn(async () => 0) },
    projectLibraries: { refreshProjects: vi.fn(async () => {}) },
    session: { refreshProject: vi.fn(async () => undefined) },
    router: { navigate: vi.fn(async () => {}) },
  }
  const stop = watchProjectStorage(dependencies)
  return {
    ...dependencies,
    unwatch,
    stop,
    change: () => onEvent('change', '/project/main.kcl'),
    switchProject: () => {
      current = false
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('project storage observation', () => {
  it.each(['files', 'snapshot'] as const)(
    'refreshes the owning %s storage through its supported behavior',
    async (kind) => {
      const watcher = setup(kind)
      try {
        watcher.change()
        await vi.waitFor(() => {
          expect(
            kind === 'files'
              ? watcher.projectLibraries.refreshProjects
              : watcher.session.refreshProject
          ).toHaveBeenCalledOnce()
        })
        expect(
          kind === 'files'
            ? watcher.session.refreshProject
            : watcher.projectLibraries.refreshProjects
        ).not.toHaveBeenCalled()
      } finally {
        watcher.stop()
      }
    }
  )

  it('does not rediscover files while a local mutation is pending', async () => {
    const watcher = setup()
    try {
      watcher.fileOperations.pending.mockResolvedValue(1)
      watcher.change()
      await watcher.fileOperations.pending.mock.results[0].value
      expect(watcher.projectLibraries.refreshProjects).not.toHaveBeenCalled()
    } finally {
      watcher.stop()
    }
  })

  it.each(['switched', 'disposed'] as const)(
    'ignores a slow pending check when the opening was %s',
    async (action) => {
      vi.useFakeTimers()
      const watcher = setup()
      const pending = Promise.withResolvers<number>()
      watcher.fileOperations.pending.mockReturnValue(pending.promise)
      try {
        watcher.change()
        await vi.advanceTimersByTimeAsync(7_000)
        if (action === 'switched') watcher.switchProject()
        else watcher.stop()
        pending.resolve(0)
        await pending.promise
        expect(watcher.projectLibraries.refreshProjects).not.toHaveBeenCalled()
        expect(watcher.session.refreshProject).not.toHaveBeenCalled()
        expect(watcher.router.navigate).not.toHaveBeenCalled()
      } finally {
        if (action === 'switched') watcher.stop()
      }
    }
  )

  it('returns home when the observed project is removed', async () => {
    const watcher = setup('snapshot')
    try {
      watcher.session.refreshProject.mockRejectedValue(
        new FileNotFound({
          operation: 'stat',
          path: '/project',
          cause: 'ENOENT',
          message: 'Removed',
        })
      )
      watcher.change()
      await vi.waitFor(() =>
        expect(watcher.router.navigate).toHaveBeenCalledWith(PATHS.HOME)
      )
    } finally {
      watcher.stop()
    }
  })

  it('unsubscribes and ignores already queued callbacks after disposal', async () => {
    const watcher = setup('snapshot')
    watcher.stop()
    watcher.change()
    await Promise.resolve()
    expect(watcher.unwatch).toHaveBeenCalledOnce()
    expect(watcher.session.refreshProject).not.toHaveBeenCalled()
  })
})
