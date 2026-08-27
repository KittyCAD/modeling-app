import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { combineCapabilities } from '@src/contracts/buffers'
import { createFsOperationQueue } from '@src/features/fsOperations/createFsOperationQueue'
import { createPersistenceCapability } from '@src/features/editorCapabilities/persistence'
import { bufferOrigin } from '@src/lib/buffers/annotations'
import { createFileBackedTextBuffer } from '@src/lib/buffers/createFileBackedTextBuffer'
import {
  type FakeFileSystem,
  createFakeFileSystem,
} from '@src/test/fakeFileSystem'

const DEBOUNCE = 600

function createHarness(
  options: { path?: string | null; readOnly?: boolean } = {}
) {
  const fileSystem = createFakeFileSystem({
    '/projects/p/main.kcl': 'thickness = 4',
  })
  const queue = createFsOperationQueue()
  const capability = createPersistenceCapability({
    fileSystem: () => fileSystem,
    queue: () => queue,
  })

  const buffer = createFileBackedTextBuffer({
    path: options.path === undefined ? '/projects/p/main.kcl' : options.path,
    contents: 'thickness = 4',
    languageId: 'kcl',
    readOnly: options.readOnly,
    capabilities: combineCapabilities([capability]),
  })

  return { fileSystem, queue, buffer }
}

function edit(
  buffer: ReturnType<typeof createFileBackedTextBuffer>,
  text: string,
  origin: 'user' | 'reconcile' = 'user'
) {
  buffer.dispatch({
    changes: { from: buffer.state.peek().doc.length, insert: text },
    annotations: bufferOrigin.of(origin),
  })
}

/** Advance past the debounce and let the queued write settle. */
async function settle() {
  await vi.advanceTimersByTimeAsync(DEBOUNCE + 10)
  await vi.runAllTicks()
  // Two real ticks, so the write promise and its `.then` both resolve.
  await Promise.resolve()
  await Promise.resolve()
}

describe('persistence capability', () => {
  let harness: ReturnType<typeof createHarness>

  beforeEach(() => {
    vi.useFakeTimers()
    harness = createHarness()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes the buffer after a quiet moment', async () => {
    const { buffer, fileSystem } = harness
    edit(buffer, '\nwidth = 60')

    // Nothing yet: a write per keystroke is what the debounce exists to avoid.
    expect(fileSystem.files.get('/projects/p/main.kcl')).toBe('thickness = 4')

    await settle()
    expect(fileSystem.files.get('/projects/p/main.kcl')).toBe(
      'thickness = 4\nwidth = 60'
    )
    expect(buffer.dirty.value).toBe(false)
  })

  it('coalesces a burst of edits into one write', async () => {
    const { buffer, fileSystem } = harness
    const writes = vi.spyOn(fileSystem, 'writeTextFile')

    edit(buffer, 'a')
    edit(buffer, 'b')
    edit(buffer, 'c')
    await settle()

    expect(writes).toHaveBeenCalledTimes(1)
    expect(fileSystem.files.get('/projects/p/main.kcl')).toBe(
      'thickness = 4abc'
    )
  })

  it('ignores a reconciliation, which would be writing the file back to itself', async () => {
    const { buffer, fileSystem } = harness
    const writes = vi.spyOn(fileSystem, 'writeTextFile')

    buffer.reconcile('changed on disk')
    await settle()

    expect(writes).not.toHaveBeenCalled()
    expect(fileSystem.files.get('/projects/p/main.kcl')).toBe('thickness = 4')
  })

  it('records write provenance, so a watcher can ignore the echo', async () => {
    const { buffer, queue } = harness
    edit(buffer, '!')
    await settle()

    const snapshot = buffer.snapshot()
    expect(queue.isOwnWrite('/projects/p/main.kcl', snapshot.contentId)).toBe(
      true
    )
  })

  it('does not mark the buffer clean when an edit landed mid-write', async () => {
    const { buffer, fileSystem } = harness
    let release: (() => void) | undefined
    vi.spyOn(fileSystem, 'writeTextFile').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )

    edit(buffer, 'first')
    await vi.advanceTimersByTimeAsync(DEBOUNCE + 10)

    // Type again while the write is in flight.
    edit(buffer, 'second')
    release?.()
    await Promise.resolve()
    await Promise.resolve()

    // The completed write is stale, so the buffer must still read as dirty.
    expect(buffer.dirty.value).toBe(true)
  })

  it('does not apply to a scratch buffer', () => {
    const { buffer } = createHarness({ path: null })
    // Nothing to write to, so the capability should not even bind.
    expect(buffer.structuralContext.value.fileBacked).toBe(false)
  })

  it('does not write a read-only buffer', async () => {
    const scoped = createHarness({ readOnly: true })
    const writes = vi.spyOn(scoped.fileSystem, 'writeTextFile')

    // Read-only is enforced by CodeMirror too, but the binding must not be
    // installed at all: a programmatic dispatch would otherwise still save.
    scoped.buffer.dispatch({
      changes: { from: 0, insert: 'x' },
      annotations: bufferOrigin.of('user'),
    })
    await settle()

    expect(writes).not.toHaveBeenCalled()
  })

  it('flushes a pending edit when the buffer closes', async () => {
    const { buffer, fileSystem } = harness
    edit(buffer, ' last words')

    // Disposal runs the binding's teardown. Closing a buffer must not lose the
    // last keystroke just because the debounce had not fired.
    buffer.dispose()
    await Promise.resolve()
    await Promise.resolve()

    expect(fileSystem.files.get('/projects/p/main.kcl')).toBe(
      'thickness = 4 last words'
    )
  })

  it('survives a failed write without marking the buffer clean', async () => {
    const { buffer, fileSystem } = harness
    vi.spyOn(fileSystem, 'writeTextFile').mockRejectedValue(
      new Error('disk full')
    )

    edit(buffer, '!')
    await settle()

    expect(buffer.dirty.value).toBe(true)
  })
})
