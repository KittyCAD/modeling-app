import { describe, expect, it, vi } from 'vitest'
import type { FileChangesPayload } from '@src/desktop/channels'
import type { DesktopBridge } from '@src/desktop/preload'
import { createElectronFileWatcher } from '@src/features/fileWatcher/createElectronFileWatcher'

/** Enough of the bridge to drive the watcher, with the IPC under test control. */
function createFakeBridge() {
  const watched: string[] = []
  const unwatched: number[] = []
  let listener: ((payload: FileChangesPayload) => void) | null = null
  let nextId = 1

  const bridge = {
    watchDirectory: async (path: string) => {
      watched.push(path)
      const id = nextId
      nextId += 1
      return id
    },
    unwatchDirectory: async (id: number) => {
      unwatched.push(id)
    },
    onFileChanges: (next: (payload: FileChangesPayload) => void) => {
      listener = next
      return () => {
        listener = null
      }
    },
  } as unknown as DesktopBridge

  return {
    bridge,
    watched,
    unwatched,
    hasListener: () => listener !== null,
    emit: (payload: FileChangesPayload) => listener?.(payload),
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createElectronFileWatcher', () => {
  it('delivers a batch to the listener for that subscription', async () => {
    const fake = createFakeBridge()
    const watcher = createElectronFileWatcher(fake.bridge)
    const seen = vi.fn()

    watcher.watch('/projects/bracket', seen)
    await flush()

    fake.emit({
      subscriptionId: 1,
      changes: [{ path: '/projects/bracket/main.kcl', kind: 'changed' }],
    })

    expect(seen).toHaveBeenCalledWith([
      { path: '/projects/bracket/main.kcl', kind: 'changed' },
    ])
  })

  it('shares one operating-system watch between features', async () => {
    const fake = createFakeBridge()
    const watcher = createElectronFileWatcher(fake.bridge)
    const first = vi.fn()
    const second = vi.fn()

    watcher.watch('/projects/bracket', first)
    watcher.watch('/projects/bracket', second)
    await flush()

    // The session and the settings service both want this folder; neither
    // should have to know the other asked.
    expect(fake.watched).toEqual(['/projects/bracket'])

    fake.emit({
      subscriptionId: 1,
      changes: [{ path: '/projects/bracket/project.toml', kind: 'changed' }],
    })
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
  })

  it('keeps watching until the last listener goes', async () => {
    const fake = createFakeBridge()
    const watcher = createElectronFileWatcher(fake.bridge)

    const stopFirst = watcher.watch('/projects/bracket', vi.fn())
    const stopSecond = watcher.watch('/projects/bracket', vi.fn())
    await flush()

    stopFirst()
    await flush()
    expect(fake.unwatched).toEqual([])

    stopSecond()
    await flush()
    expect(fake.unwatched).toEqual([1])
  })

  it('routes each root to its own listeners', async () => {
    const fake = createFakeBridge()
    const watcher = createElectronFileWatcher(fake.bridge)
    const bracket = vi.fn()
    const enclosure = vi.fn()

    watcher.watch('/projects/bracket', bracket)
    watcher.watch('/projects/enclosure', enclosure)
    await flush()

    fake.emit({
      subscriptionId: 2,
      changes: [{ path: '/projects/enclosure/main.kcl', kind: 'changed' }],
    })

    expect(bracket).not.toHaveBeenCalled()
    expect(enclosure).toHaveBeenCalledOnce()
  })

  it('releases a watch disposed before the subscription resolved', async () => {
    const fake = createFakeBridge()
    const watcher = createElectronFileWatcher(fake.bridge)

    // The round trip to the main process is asynchronous, so a project opened
    // and closed quickly would otherwise leave a watch nobody can reach.
    const stop = watcher.watch('/projects/bracket', vi.fn())
    stop()
    await flush()

    expect(fake.unwatched).toEqual([1])
  })

  it('re-watches a root after it was fully released', async () => {
    const fake = createFakeBridge()
    const watcher = createElectronFileWatcher(fake.bridge)

    watcher.watch('/projects/bracket', vi.fn())()
    await flush()
    const seen = vi.fn()
    watcher.watch('/projects/bracket', seen)
    await flush()

    expect(fake.watched).toEqual(['/projects/bracket', '/projects/bracket'])
    fake.emit({
      subscriptionId: 2,
      changes: [{ path: '/projects/bracket/main.kcl', kind: 'changed' }],
    })
    expect(seen).toHaveBeenCalledOnce()
  })

  it('survives a listener that throws', async () => {
    const fake = createFakeBridge()
    const watcher = createElectronFileWatcher(fake.bridge)
    const after = vi.fn()

    watcher.watch('/projects/bracket', () => {
      throw new Error('boom')
    })
    watcher.watch('/projects/bracket', after)
    await flush()

    fake.emit({
      subscriptionId: 1,
      changes: [{ path: '/projects/bracket/main.kcl', kind: 'changed' }],
    })

    // One broken consumer must not stop the rest of the app hearing about it.
    expect(after).toHaveBeenCalledOnce()
  })

  it('drops its bridge listener when disposed', async () => {
    const fake = createFakeBridge()
    const watcher = createElectronFileWatcher(fake.bridge)
    watcher.watch('/projects/bracket', vi.fn())
    await flush()

    watcher.dispose()
    expect(fake.hasListener()).toBe(false)
    await flush()
    expect(fake.unwatched).toEqual([1])
  })
})
