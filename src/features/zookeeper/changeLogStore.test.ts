import { ChangeSet, Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { createFsOperationQueue } from '@src/features/fsOperations/createFsOperationQueue'
import { createChangeLogStore } from '@src/features/zookeeper/changeLogStore'
import { inverseForContribution } from '@src/lib/collab/revert'
import type { AppliedChange } from '@src/lib/collab/revert'
import { hashString } from '@src/lib/hash'
import { createFakeFileSystem } from '@src/test/fakeFileSystem'

const PROJECT = '/projects/bracket'
const PATH = 'main.kcl'
const TURN = 'turn-1'

function setup(initial: Record<string, string> = {}) {
  const fileSystem = createFakeFileSystem(initial)
  const queue = createFsOperationQueue()
  return {
    fileSystem,
    queue,
    store: createChangeLogStore({ projectPath: PROJECT, fileSystem, queue }),
    /**
     * A second store over the same disk, as a fresh session would build.
     *
     * The reload has to be simulated this way rather than by reusing the first
     * store: reusing it would prove only that the store remembers its own
     * argument, which is not the claim.
     */
    reopen: () =>
      createChangeLogStore({
        projectPath: PROJECT,
        fileSystem,
        queue: createFsOperationQueue(),
      }),
  }
}

/** A session, recorded the way `changeHistory` would. */
function session(start: string) {
  let doc = Text.of(start.split('\n'))
  const entries: AppliedChange[] = []

  return {
    entries,
    head: () => doc.toString(),
    apply(
      specs: { from: number; to?: number; insert: string }[],
      contributionId: string | null
    ) {
      const changes = ChangeSet.of(specs, doc.length)
      entries.push({ changes, docBefore: doc, contributionId })
      doc = changes.apply(doc)
    },
  }
}

describe('createChangeLogStore', () => {
  it('has nothing for a file it has never seen', async () => {
    const { store } = setup()

    await expect(store.load(PATH, 'width = 10\n')).resolves.toBeNull()
  })

  /**
   * The point of the whole thing: a turn applied in one session is still exactly
   * revertible in the next.
   */
  it('carries an exact revert across a reload', async () => {
    const { store, reopen } = setup()
    const live = session('width = 10\ndepth = 2\n')
    live.apply([{ from: 11, to: 20, insert: 'depth = 22' }], TURN)
    live.apply([{ from: 0, to: 0, insert: '// mine\n' }], null)

    await store.save(PATH, live.entries, live.head())

    // Nothing of the first session's memory survives except the disk.
    const restored = await reopen().load(PATH, live.head())
    expect(restored).not.toBeNull()
    if (restored === null) return

    const inverse = inverseForContribution({
      applied: restored,
      contributionId: TURN,
    })
    expect(inverse.changes).not.toBeNull()
    if (inverse.changes === null) return

    const head = Text.of(live.head().split('\n'))
    expect(inverse.changes.apply(head).toString()).toBe(
      '// mine\nwidth = 10\ndepth = 2\n'
    )
  })

  /** The honest limit: no amount of stored history survives an outside edit. */
  it('refuses history for a file edited outside the app', async () => {
    const { store } = setup()
    const live = session('width = 10\n')
    live.apply([{ from: 0, to: 5, insert: 'thickness' }], TURN)
    await store.save(PATH, live.entries, live.head())

    await expect(store.load(PATH, 'edited in vim\n')).resolves.toBeNull()
  })

  /**
   * Filenames are hashed because a project-relative path has separators in it.
   * The path is stored inside so a collision is detectable rather than silent.
   */
  it('stores the file under a hashed name, with its path inside', async () => {
    const { store, fileSystem } = setup()
    const live = session('width = 10\n')
    live.apply([{ from: 0, insert: 'x' }], TURN)

    await store.save(PATH, live.entries, live.head())

    const expected = `${PROJECT}/.zoo/history/${hashString(PATH)}.json`
    expect(fileSystem.files.has(expected)).toBe(true)
    expect(fileSystem.files.get(expected)).toContain(`"path":"${PATH}"`)
  })

  it('keeps history for two files apart', async () => {
    const { store } = setup()
    const one = session('a\n')
    one.apply([{ from: 1, insert: 'b' }], TURN)
    const two = session('c\n')
    two.apply([{ from: 1, insert: 'd' }], TURN)

    await store.save('one.kcl', one.entries, one.head())
    await store.save('two.kcl', two.entries, two.head())

    const loadedOne = await store.load('one.kcl', one.head())
    const loadedTwo = await store.load('two.kcl', two.head())

    expect(loadedOne).toHaveLength(1)
    expect(loadedTwo).toHaveLength(1)
    expect(loadedOne?.[0].docBefore.toString()).toBe('a\n')
    expect(loadedTwo?.[0].docBefore.toString()).toBe('c\n')
  })

  it('survives a file whose contents are not JSON', async () => {
    const path = `${PROJECT}/.zoo/history/${hashString(PATH)}.json`
    const { store } = setup({ [path]: 'not json at all' })

    await expect(store.load(PATH, 'width = 10\n')).resolves.toBeNull()
  })

  it('overwrites the log it already wrote', async () => {
    const { store } = setup()
    const live = session('a\n')
    live.apply([{ from: 1, insert: 'b' }], TURN)
    await store.save(PATH, live.entries, live.head())

    live.apply([{ from: 2, insert: 'c' }], 'turn-2')
    await store.save(PATH, live.entries, live.head())

    const restored = await store.load(PATH, live.head())
    expect(restored?.map((entry) => entry.contributionId)).toEqual([
      TURN,
      'turn-2',
    ])
  })

  it('removes a log', async () => {
    const { store, fileSystem } = setup()
    const live = session('a\n')
    live.apply([{ from: 1, insert: 'b' }], TURN)
    await store.save(PATH, live.entries, live.head())

    await store.remove(PATH)

    expect(fileSystem.files.size).toBe(0)
    await expect(store.load(PATH, live.head())).resolves.toBeNull()
  })

  it('is content removing one that is already gone', async () => {
    const { store } = setup()

    await expect(store.remove(PATH)).resolves.toBeUndefined()
  })

  /**
   * Provenance, so the watcher does not read our own write back as an external
   * change and hand it to `reconcileExternalChange`.
   */
  it('records its write so the watcher recognises it', async () => {
    const { store, queue, fileSystem } = setup()
    const live = session('a\n')
    live.apply([{ from: 1, insert: 'b' }], TURN)

    await store.save(PATH, live.entries, live.head())

    const file = `${PROJECT}/.zoo/history/${hashString(PATH)}.json`
    const contents = fileSystem.files.get(file) ?? ''
    expect(queue.isOwnWrite(file, hashString(contents))).toBe(true)
  })

  /** Storage, as a measured ratio rather than a promise. */
  it('costs about one extra copy of the file', async () => {
    const { store, fileSystem } = setup()
    const live = session(
      `@settings(defaultLengthUnit = mm)\n${'width = 10\n'.repeat(80)}`
    )
    // Twenty turns, with three hundred keystrokes of typing between each.
    for (let turn = 0; turn < 20; turn += 1) {
      for (let key = 0; key < 300; key += 1) {
        live.apply([{ from: 34 + key, insert: 'x' }], null)
      }
      live.apply(
        [{ from: 34, to: 44, insert: `depth = ${turn}\n` }],
        `t${turn}`
      )
    }

    await store.save(PATH, live.entries, live.head())

    const file = `${PROJECT}/.zoo/history/${hashString(PATH)}.json`
    const logBytes = (fileSystem.files.get(file) ?? '').length
    const fileBytes = live.head().length

    // Compaction is what makes this true: 6,020 transactions became 40 rows.
    expect(logBytes).toBeLessThan(fileBytes * 3)
  })
})
