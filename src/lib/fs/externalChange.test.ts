import { describe, expect, it } from 'vitest'
import { createFsOperationQueue } from '@src/features/fsOperations/createFsOperationQueue'
import { readExternalChange } from '@src/lib/fs/externalChange'
import { hashString } from '@src/lib/hash'
import { createFakeFileSystem } from '@src/test/fakeFileSystem'

describe('readExternalChange', () => {
  it('reads a file somebody else changed', async () => {
    const fileSystem = createFakeFileSystem({ '/p/main.kcl': 'theirs' })

    expect(
      await readExternalChange(fileSystem, createFsOperationQueue(), {
        path: '/p/main.kcl',
        kind: 'changed',
      })
    ).toEqual({ contents: 'theirs' })
  })

  it('rejects this app’s own write coming back', async () => {
    const fileSystem = createFakeFileSystem({ '/p/main.kcl': 'ours' })
    const queue = createFsOperationQueue()
    queue.recordWrite('/p/main.kcl', hashString('ours'))

    expect(
      await readExternalChange(fileSystem, queue, {
        path: '/p/main.kcl',
        kind: 'changed',
      })
    ).toBeNull()
  })

  it('accepts a later external edit to a path this app wrote', async () => {
    const fileSystem = createFakeFileSystem({ '/p/main.kcl': 'ours' })
    const queue = createFsOperationQueue()
    queue.recordWrite('/p/main.kcl', hashString('ours'))

    // Matching is on content, not on the path or the clock: a genuine edit that
    // lands inside the provenance window must still get through.
    await fileSystem.writeTextFile('/p/main.kcl', 'theirs')

    expect(
      await readExternalChange(fileSystem, queue, {
        path: '/p/main.kcl',
        kind: 'changed',
      })
    ).toEqual({ contents: 'theirs' })
  })

  it('reads nothing for a removal', async () => {
    const fileSystem = createFakeFileSystem({ '/p/main.kcl': 'x' })

    expect(
      await readExternalChange(fileSystem, createFsOperationQueue(), {
        path: '/p/gone.kcl',
        kind: 'removed',
      })
    ).toBeNull()
  })

  it('stays quiet when the file cannot be read', async () => {
    // Racing the writer is normal: the file can vanish between the event and
    // the read, and the next event will bring it.
    expect(
      await readExternalChange(
        createFakeFileSystem(),
        createFsOperationQueue(),
        {
          path: '/p/missing.kcl',
          kind: 'changed',
        }
      )
    ).toBeNull()
  })
})
