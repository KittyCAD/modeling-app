import { describe, expect, it } from 'vitest'
import { combineCapabilities } from '@src/contracts/buffers'
import { createPersistenceCapability } from '@src/features/editorCapabilities/persistence'
import { createFsOperationQueue } from '@src/features/fsOperations/createFsOperationQueue'
import { createFileBackedTextBuffer } from '@src/lib/buffers/createFileBackedTextBuffer'
import { createFakeFileSystem } from '@src/test/fakeFileSystem'

/** Longer than the save debounce. */
const afterDebounce = () => new Promise((resolve) => setTimeout(resolve, 750))

function open(initial: string) {
  const fileSystem = createFakeFileSystem({ '/p/main.kcl': initial })
  const queue = createFsOperationQueue()
  const buffer = createFileBackedTextBuffer({
    path: '/p/main.kcl',
    contents: initial,
    languageId: 'kcl',
    capabilities: combineCapabilities([
      createPersistenceCapability({
        fileSystem: () => fileSystem,
        queue: () => queue,
      }),
    ]),
  })
  return { fileSystem, queue, buffer }
}

describe('autosave and an unresolved conflict', () => {
  it('saves normally when nothing has diverged', async () => {
    const { fileSystem, buffer } = open('thickness = 4')

    buffer.dispatch({ changes: { from: 0, insert: '// mine\n' } })
    await afterDebounce()

    expect(fileSystem.files.get('/p/main.kcl')).toContain('// mine')
  })

  it('does not write over a file it knows has diverged', async () => {
    const { fileSystem, buffer } = open('thickness = 4')

    buffer.dispatch({ changes: { from: 0, insert: '// mine\n' } })
    // The file changed underneath the unsaved edit, so the user has been shown
    // a choice they have not made yet.
    buffer.reconcile('thickness = 99')
    expect(buffer.divergence.value).toBe('thickness = 99')

    await afterDebounce()

    // Autosaving here would destroy content the user has never seen, and clear
    // the warning about it on the way past.
    expect(fileSystem.files.get('/p/main.kcl')).toBe('thickness = 4')
    expect(buffer.divergence.value).toBe('thickness = 99')
  })

  it('saves as soon as the user keeps their own version', async () => {
    const { fileSystem, buffer } = open('thickness = 4')

    buffer.dispatch({ changes: { from: 0, insert: '// mine\n' } })
    buffer.reconcile('thickness = 99')
    await afterDebounce()

    buffer.dismissDivergence()
    await afterDebounce()

    // "Keep mine" changes no text, so nothing schedules a save from the edit
    // side; resolving the conflict has to be what resumes it.
    expect(fileSystem.files.get('/p/main.kcl')).toContain('// mine')
  })

  it('writes the file’s version once the user accepts it', async () => {
    const { fileSystem, buffer } = open('thickness = 4')

    buffer.dispatch({ changes: { from: 0, insert: '// mine\n' } })
    buffer.reconcile('thickness = 99')
    buffer.acceptDivergence()
    await afterDebounce()

    expect(buffer.text.value).toBe('thickness = 99')
    expect(buffer.divergence.value).toBeNull()
  })

  it('does not flush a diverged buffer on the way out', async () => {
    const { fileSystem, buffer } = open('thickness = 4')

    buffer.dispatch({ changes: { from: 0, insert: '// mine\n' } })
    buffer.reconcile('thickness = 99')
    // Disposal flushes pending work, which must still not include a write the
    // user has not agreed to.
    buffer.dispose()
    await afterDebounce()

    expect(fileSystem.files.get('/p/main.kcl')).toBe('thickness = 4')
  })
})
