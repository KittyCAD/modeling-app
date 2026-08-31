import { describe, expect, it } from 'vitest'
import type { Turn } from '@src/contracts/zookeeper'
import { createFsOperationQueue } from '@src/features/fsOperations/createFsOperationQueue'
import {
  type StoredTranscript,
  createTranscriptStore,
} from '@src/features/zookeeper/transcriptStore'
import { hashString } from '@src/lib/hash'
import { createFakeFileSystem } from '@src/test/fakeFileSystem'

const PROJECT = '/projects/bracket'
const FILE = `${PROJECT}/.zoo/conversations/c1.jsonl`

function setup(initial: Record<string, string> = {}) {
  const fileSystem = createFakeFileSystem(initial)
  const queue = createFsOperationQueue()
  return {
    fileSystem,
    queue,
    store: createTranscriptStore({ projectPath: PROJECT, fileSystem, queue }),
  }
}

const turn = (overrides: Partial<Turn> = {}): Turn => ({
  id: 'turn-1',
  prompt: 'make it thicker',
  response: 'Done.',
  at: 1000,
  status: 'complete',
  paths: ['main.kcl'],
  conflicts: [],
  waiting: [],
  reasoning: [],
  ...overrides,
})

const transcript = (
  overrides: Partial<StoredTranscript> = {}
): StoredTranscript => ({
  id: 'c1',
  remoteId: 'remote-1',
  createdAt: 1000,
  turns: [turn()],
  ...overrides,
})

describe('createTranscriptStore', () => {
  it('has nothing for a project nobody has asked about', async () => {
    const { store } = setup()

    await expect(store.list()).resolves.toEqual([])
    await expect(store.read('c1')).resolves.toBeNull()
  })

  /**
   * Under a dotted directory on purpose: `projectFiles` already skips names
   * starting with `.`, so the explorer, `session.files` and the baseline capture
   * all ignore it — which is what stops the agent being sent its own transcripts
   * as project context.
   */
  it('writes beside the project, under a dotted directory', async () => {
    const { store, fileSystem } = setup()

    await store.save(transcript())

    expect(fileSystem.files.has(FILE)).toBe(true)
  })

  it('reads back what it wrote', async () => {
    const { store } = setup()
    const original = transcript()

    await store.save(original)

    await expect(store.read('c1')).resolves.toEqual(original)
  })

  it('writes one JSON object per line', async () => {
    const { store, fileSystem } = setup()

    await store.save(
      transcript({ turns: [turn({ id: 't1' }), turn({ id: 't2' })] })
    )

    const lines = (fileSystem.files.get(FILE) ?? '')
      .split('\n')
      .filter((line) => line !== '')
    expect(lines).toHaveLength(3)
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow()
    expect(JSON.parse(lines[0]).kind).toBe('meta')
    expect(JSON.parse(lines[1]).kind).toBe('turn')
  })

  it('keeps the remote id, so a conversation can be resumed', async () => {
    const { store } = setup()

    await store.save(transcript({ remoteId: 'conv-42' }))

    await expect(store.read('c1')).resolves.toMatchObject({
      remoteId: 'conv-42',
    })
  })

  it('records everything a turn reported', async () => {
    const { store } = setup()
    const rich = turn({
      paths: ['main.kcl', 'lid.kcl'],
      conflicts: [{ path: 'other.kcl', reason: 'overlapping', edits: [] }],
      waiting: ['held.kcl'],
      status: 'waiting',
    })

    await store.save(transcript({ turns: [rich] }))

    const read = await store.read('c1')
    expect(read?.turns[0]).toEqual(rich)
  })

  /**
   * The reason for JSONL rather than one JSON document. A crash mid-write leaves
   * a partial last line; losing the two hundred turns before it because of that
   * would defeat the format.
   */
  it('keeps the reasoning a turn showed its working with', async () => {
    const { store } = setup()

    await store.save(
      transcript({
        turns: [
          turn({
            reasoning: [
              { kind: 'text', content: 'Looking at the wall.' },
              {
                kind: 'plan',
                steps: [{ path: 'main.kcl', instructions: 'Widen it' }],
              },
              { kind: 'file', action: 'updated', path: 'main.kcl' },
            ],
          }),
        ],
      })
    )

    const read = await store.read('c1')
    expect(read?.turns[0].reasoning).toEqual([
      { kind: 'text', content: 'Looking at the wall.' },
      { kind: 'plan', steps: [{ path: 'main.kcl', instructions: 'Widen it' }] },
      { kind: 'file', action: 'updated', path: 'main.kcl' },
    ])
  })

  /**
   * A transcript written before reasoning existed. The version was deliberately
   * not bumped to add the field: an unrecognised version skips every line
   * including the meta one, so bumping would have made every conversation
   * anybody had already had read as absent.
   */
  it('reads a transcript written before reasoning existed', async () => {
    const legacy = [
      JSON.stringify({
        v: 1,
        kind: 'meta',
        id: 'c1',
        remoteId: 'remote-1',
        createdAt: 1000,
      }),
      JSON.stringify({
        v: 1,
        kind: 'turn',
        turn: {
          id: 'turn-1',
          prompt: 'make it thicker',
          response: 'Done.',
          at: 1000,
          status: 'complete',
          paths: ['main.kcl'],
          conflicts: [],
          waiting: [],
        },
      }),
    ].join('\n')

    const { store } = setup({ [FILE]: `${legacy}\n` })

    const read = await store.read('c1')
    expect(read?.turns).toHaveLength(1)
    expect(read?.turns[0].prompt).toBe('make it thicker')
    // Normalised, so nothing downstream has to guard for a missing array.
    expect(read?.turns[0].reasoning).toEqual([])
  })

  it('recovers the turns before a truncated final line', async () => {
    const { store, fileSystem } = setup()
    await store.save(
      transcript({ turns: [turn({ id: 't1' }), turn({ id: 't2' })] })
    )

    const whole = fileSystem.files.get(FILE) ?? ''
    fileSystem.files.set(FILE, `${whole.slice(0, whole.length - 12)}`)

    const read = await store.read('c1')
    expect(read).not.toBeNull()
    expect(read?.turns.map((each) => each.id)).toEqual(['t1'])
  })

  it('reports nothing for a file with no meta line', async () => {
    const { store } = setup({
      [FILE]: `${JSON.stringify({ v: 1, kind: 'turn', turn: turn() })}\n`,
    })

    await expect(store.read('c1')).resolves.toBeNull()
  })

  /** An older format is not read as if it were this one. */
  it('ignores lines from a different format version', async () => {
    const { store } = setup({
      [FILE]: `${JSON.stringify({
        v: 99,
        kind: 'meta',
        id: 'c1',
        remoteId: null,
        createdAt: 1,
      })}\n`,
    })

    await expect(store.read('c1')).resolves.toBeNull()
  })

  it('lists every conversation, newest first', async () => {
    const { store } = setup()
    await store.save(transcript({ id: 'older', createdAt: 1000 }))
    await store.save(transcript({ id: 'newer', createdAt: 2000 }))

    const listed = await store.list()

    expect(listed.map((each) => each.id)).toEqual(['newer', 'older'])
  })

  /** The directory is the index; a separate one would be a second truth to drift. */
  it('ignores files that are not transcripts', async () => {
    const { store, fileSystem } = setup()
    await store.save(transcript())
    fileSystem.files.set(
      `${PROJECT}/.zoo/conversations/notes.txt`,
      'not a transcript'
    )

    const listed = await store.list()

    expect(listed.map((each) => each.id)).toEqual(['c1'])
  })

  it('overwrites a conversation it already stored', async () => {
    const { store } = setup()
    await store.save(transcript({ turns: [turn({ id: 't1' })] }))

    await store.save(
      transcript({ turns: [turn({ id: 't1' }), turn({ id: 't2' })] })
    )

    const read = await store.read('c1')
    expect(read?.turns.map((each) => each.id)).toEqual(['t1', 't2'])
    expect(await store.list()).toHaveLength(1)
  })

  it('removes a conversation', async () => {
    const { store, fileSystem } = setup()
    await store.save(transcript())

    await store.remove('c1')

    expect(fileSystem.files.has(FILE)).toBe(false)
    await expect(store.read('c1')).resolves.toBeNull()
  })

  it('is content with removing one that is already gone', async () => {
    const { store } = setup()

    await expect(store.remove('nope')).resolves.toBeUndefined()
  })

  /**
   * Provenance, so the watcher does not read our own write back as an external
   * change and hand it to `reconcileExternalChange`.
   */
  it('records the write so the watcher can recognise it', async () => {
    const { store, queue, fileSystem } = setup()

    await store.save(transcript())

    const contents = fileSystem.files.get(FILE) ?? ''
    expect(queue.isOwnWrite(FILE, hashString(contents))).toBe(true)
  })

  it('stores a conversation with no turns yet', async () => {
    const { store } = setup()

    await store.save(transcript({ turns: [] }))

    await expect(store.read('c1')).resolves.toMatchObject({ turns: [] })
  })
})
