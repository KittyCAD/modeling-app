import { computed, signal } from '@preact/signals'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AuthService } from '@src/contracts/auth'
import type {
  ProjectSession,
  ProjectSessionService,
} from '@src/contracts/projectSession'
import { createFsOperationQueue } from '@src/features/fsOperations/createFsOperationQueue'
import { createZookeeperService } from '@src/features/zookeeper/createZookeeperService'
import { createFakeFileSystem } from '@src/test/fakeFileSystem'

/** A socket that never opens, so nothing here waits on a network. */
class InertWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readyState = InertWebSocket.CONNECTING
  binaryType = 'blob'
  onopen: unknown = null
  onmessage: unknown = null
  onerror: unknown = null
  onclose: unknown = null

  constructor(readonly url: string) {}
  send() {}
  close() {
    this.readyState = InertWebSocket.CLOSED
  }
}

const URL_BASE = 'wss://zookeeper.example/ws'

/** Let the store's reads and writes finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function setup(
  options: {
    url?: string | undefined
    token?: string | null
    session?: ProjectSession | null
    files?: Record<string, string>
  } = {}
) {
  const token = signal<string | null>(
    options.token === undefined ? 'tok-1' : options.token
  )
  // `in` rather than `??`, so an explicit `session: null` means "no project"
  // instead of falling through to the default.
  const current = signal<ProjectSession | null>(
    'session' in options ? (options.session ?? null) : fakeSession()
  )

  const auth = { token: computed(() => token.value) } as unknown as AuthService
  const sessions = {
    current: computed(() => current.value),
  } as unknown as ProjectSessionService
  // A real fake filesystem, because transcripts are written on turn boundaries
  // and a stub would make those writes silently do nothing.
  const fileSystem = createFakeFileSystem(options.files ?? {})

  return {
    token,
    current,
    fileSystem,
    service: createZookeeperService({
      auth,
      sessions,
      fileSystem,
      queue: createFsOperationQueue(),
      url: 'url' in options ? options.url : URL_BASE,
    }),
  }
}

function fakeSession(): ProjectSession {
  return {
    bufferForPath: () => undefined,
    executingBuffer: computed(() => null),
    project: computed(() => ({ path: '/projects/bracket' })),
    captureSnapshot: () => ({
      operationId: 'op-1',
      capturedAt: 0,
      projectPath: '/projects/bracket',
      buffers: [],
    }),
    files: computed(() => []),
  } as unknown as ProjectSession
}

describe('createZookeeperService', () => {
  const originalWebSocket = globalThis.WebSocket

  beforeEach(() => {
    // biome-ignore lint/suspicious/noExplicitAny: substituting a browser global
    globalThis.WebSocket = InertWebSocket as any
  })

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket
  })

  it('is available with a service, a token and a project', () => {
    const { service } = setup()

    expect(service.available.value).toBe(true)
    expect(service.unavailableReason.value).toBeNull()
  })

  /**
   * A build with no service configured is a supported state, not a broken one,
   * and it outranks the others: no amount of signing in makes it work.
   */
  it('reports a missing service ahead of anything else', () => {
    const { service } = setup({ url: undefined, token: null, session: null })

    expect(service.unavailableReason.value).toMatch(/no zookeeper service/i)
  })

  it('asks for a sign-in when there is no token', () => {
    const { service } = setup({ token: null })

    expect(service.available.value).toBe(false)
    expect(service.unavailableReason.value).toMatch(/sign in/i)
  })

  it('asks for a project when none is open', () => {
    const { service } = setup({ session: null })

    expect(service.unavailableReason.value).toMatch(/open a project/i)
  })

  it('becomes available when a token arrives', () => {
    const { service, token } = setup({ token: null })
    expect(service.available.value).toBe(false)

    token.value = 'tok-2'

    expect(service.available.value).toBe(true)
  })

  it('opens a conversation and makes it active', async () => {
    const { service } = setup()

    const id = service.open()

    expect(id).not.toBeNull()
    if (id === null) return
    expect(service.active.value).toBe(id)
    expect(service.conversation(id)).toBeDefined()
    expect(service.conversations.value.size).toBe(1)
  })

  /**
   * The conversation survives a connection that never came up. Its transcript
   * and its error are what the panel has to show; throwing it away would leave
   * somebody looking at an empty panel with no account of what went wrong.
   */
  it('keeps a conversation whose connection failed', async () => {
    const { service } = setup()

    const id = service.open()

    expect(id).not.toBeNull()
    expect(service.conversations.value.size).toBe(1)
  })

  it('refuses to open while unavailable', async () => {
    const { service } = setup({ token: null })

    expect(service.open()).toBeNull()
    expect(service.conversations.value.size).toBe(0)
  })

  it('opens more than one conversation', async () => {
    const { service } = setup()

    const first = service.open()
    const second = service.open()

    expect(first).not.toBe(second)
    expect(service.conversations.value.size).toBe(2)
    // The newest is the one on screen.
    expect(service.active.value).toBe(second)
  })

  it('gives each conversation its own author', async () => {
    const { service } = setup()

    const first = service.open()
    const second = service.open()
    if (first === null || second === null) return

    expect(service.conversation(first)?.author).not.toBe(
      service.conversation(second)?.author
    )
  })

  it('activates an existing conversation', async () => {
    const { service } = setup()
    const first = service.open()
    service.open()
    if (first === null) return

    service.activate(first)

    expect(service.active.value).toBe(first)
  })

  it('ignores a request to activate one it does not have', async () => {
    const { service } = setup()
    const id = service.open()

    service.activate('nope')

    expect(service.active.value).toBe(id)
  })

  it('falls back to the remaining conversation when the active one closes', async () => {
    const { service } = setup()
    const first = service.open()
    const second = service.open()
    if (second === null) return

    service.close(second)

    expect(service.active.value).toBe(first)
    expect(service.conversations.value.size).toBe(1)
  })

  /** Nothing open is a real state, and the one meant by closing the last of them. */
  it('leaves nothing active when the last conversation closes', async () => {
    const { service } = setup()
    const id = service.open()
    if (id === null) return

    service.close(id)

    expect(service.active.value).toBeNull()
    expect(service.conversations.value.size).toBe(0)
  })

  it('ignores closing one it does not have', async () => {
    const { service } = setup()
    const id = service.open()

    service.close('nope')

    expect(service.active.value).toBe(id)
    expect(service.conversations.value.size).toBe(1)
  })

  /**
   * Turn boundaries only, so this is the seam persistence hangs off. A conversation
   * with no finished turn has nothing worth writing.
   */
  it('writes nothing until a turn settles', async () => {
    const { service, fileSystem } = setup()

    service.open()
    await settle()

    expect([...fileSystem.files.keys()]).not.toContainEqual(
      expect.stringContaining('.zoo/conversations')
    )
  })

  it('lists nothing stored for a project with no transcripts', async () => {
    const { service } = setup()
    await settle()

    expect(service.stored.value).toEqual([])
  })

  /**
   * Written by an earlier session, so this is what a reload actually sees.
   */
  it('finds a transcript an earlier session left behind', async () => {
    const stored = [
      JSON.stringify({
        v: 1,
        kind: 'meta',
        id: 'old',
        remoteId: 'remote-9',
        createdAt: 500,
      }),
      JSON.stringify({
        v: 1,
        kind: 'turn',
        turn: {
          id: 't1',
          prompt: 'add a fillet',
          response: 'Done.',
          at: 500,
          status: 'complete',
          paths: ['main.kcl'],
          conflicts: [],
          waiting: [],
        },
      }),
    ].join('\n')

    const { service } = setup({
      files: {
        '/projects/bracket/.zoo/conversations/old.jsonl': `${stored}\n`,
      },
    })
    await settle()

    expect(service.stored.value.map((each) => each.id)).toEqual(['old'])
    expect(service.stored.value[0].turns[0].prompt).toBe('add a fillet')
  })

  it('reopens a stored conversation with its turns', async () => {
    const stored = [
      JSON.stringify({
        v: 1,
        kind: 'meta',
        id: 'old',
        remoteId: 'remote-9',
        createdAt: 500,
      }),
      JSON.stringify({
        v: 1,
        kind: 'turn',
        turn: {
          id: 't1',
          prompt: 'add a fillet',
          response: 'Done.',
          at: 500,
          status: 'complete',
          paths: [],
          conflicts: [],
          waiting: [],
        },
      }),
    ].join('\n')

    const { service } = setup({
      files: {
        '/projects/bracket/.zoo/conversations/old.jsonl': `${stored}\n`,
      },
    })
    await settle()

    const id = service.resume('old')

    expect(id).toBe('old')
    expect(service.conversation('old')?.transcript.value).toHaveLength(1)
    expect(service.active.value).toBe('old')
  })

  it('activates a conversation already open rather than opening it twice', async () => {
    const { service } = setup()
    const id = service.open()
    await settle()
    if (id === null) return

    expect(service.resume(id)).toBe(id)
    expect(service.conversations.value.size).toBe(1)
  })

  it('declines to resume one it has never heard of', async () => {
    const { service } = setup()
    await settle()

    expect(service.resume('nope')).toBeNull()
  })

  it('forgets a stored conversation, on disk as well', async () => {
    const stored = JSON.stringify({
      v: 1,
      kind: 'meta',
      id: 'old',
      remoteId: null,
      createdAt: 500,
    })
    const path = '/projects/bracket/.zoo/conversations/old.jsonl'
    const { service, fileSystem } = setup({ files: { [path]: `${stored}\n` } })
    await settle()
    expect(service.stored.value).toHaveLength(1)

    service.forget('old')
    await settle()

    expect(service.stored.value).toEqual([])
    expect(fileSystem.files.has(path)).toBe(false)
  })

  it('reports nobody holding a path that is untouched', () => {
    const { service } = setup()

    expect(service.holderOf('main.kcl').value).toBeNull()
  })
})
