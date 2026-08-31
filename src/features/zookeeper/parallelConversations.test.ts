import { history } from '@codemirror/commands'
import type {
  MlCopilotClientMessage,
  MlCopilotServerMessage,
} from '@kittycad/lib'
import { describe, expect, it } from 'vitest'
import {
  type EditorCapability,
  type FileBackedTextBuffer,
  combineCapabilities,
} from '@src/contracts/buffers'
import type { ApplyTarget } from '@src/features/zookeeper/applyChanges'
import { createConversation } from '@src/features/zookeeper/createConversation'
import { createFileBackedTextBuffer } from '@src/lib/buffers/createFileBackedTextBuffer'
import { createChangeHistory } from '@src/lib/collab/changeHistory'
import { createWriteClaims } from '@src/lib/collab/claims'

/**
 * Two conversations working at the same time.
 *
 * Asked of the conversations rather than of the panel, because the question is
 * whether the *model* serialises anything: the panel disables its composer on
 * that conversation's own status, so if a second conversation can run here then
 * a blocked second tab is a connection fact, not a design decision.
 */

const historyCapability: EditorCapability = {
  id: 'history',
  extension: () => history(),
}

const textOf = (buffer: FileBackedTextBuffer) =>
  buffer.state.peek().doc.toString()

function fakeTransport() {
  const listeners = new Set<(message: MlCopilotServerMessage) => void>()
  const sent: MlCopilotClientMessage[] = []

  return {
    sent,
    transport: {
      send(message: MlCopilotClientMessage) {
        sent.push(message)
      },
      onMessage(listener: (message: MlCopilotServerMessage) => void) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    receive(message: MlCopilotServerMessage) {
      for (const listener of [...listeners]) listener(message)
    },
  }
}

/** One project, two files, two conversations, one shared log and claim set. */
function project() {
  const buffers = new Map<string, FileBackedTextBuffer>()
  for (const [path, contents] of [
    ['main.kcl', 'width = 10\n'],
    ['bracket.kcl', 'depth = 2\n'],
  ]) {
    buffers.set(
      path,
      createFileBackedTextBuffer({
        path,
        contents,
        languageId: 'kcl',
        capabilities: combineCapabilities([historyCapability]),
      })
    )
  }

  const target: ApplyTarget = {
    bufferForPath: (path) => buffers.get(path),
    executingBufferId: () => null,
  }
  const changeHistory = createChangeHistory()
  const claims = createWriteClaims()

  const conversationOn = (id: string) => {
    const wire = fakeTransport()
    const conversation = createConversation({
      id,
      author: `zookeeper:${id}`,
      transport: wire.transport,
      target,
      changeHistory,
      claims,
      captureProject: async () =>
        new Map([...buffers].map(([path, buffer]) => [path, textOf(buffer)])),
    })
    return { wire, conversation }
  }

  const buffer = (path: string) => {
    const found = buffers.get(path)
    if (found === undefined) throw new Error(`${path} is not open.`)
    return found
  }

  return { conversationOn, buffer }
}

const updated = (files: Record<string, string>): MlCopilotServerMessage => ({
  project_updated: { files },
})

describe('two conversations at once', () => {
  /** The question directly: does one streaming turn stop the other sending? */
  it('lets the second send while the first is still streaming', async () => {
    const app = project()
    const a = app.conversationOn('c1')
    const b = app.conversationOn('c2')

    await a.conversation.send('make it wider')
    a.wire.receive({ delta: { delta: 'Working on it' } })
    expect(a.conversation.status.value).toBe('streaming')

    await b.conversation.send('add a fillet')

    // The prompt reached the wire rather than being queued or dropped.
    expect(b.wire.sent).toHaveLength(1)
    expect(b.conversation.status.value).toBe('streaming')
    // And the first turn is untouched by the second starting.
    expect(a.conversation.status.value).toBe('streaming')
  })

  /** The motivating case: different files, so nothing has to wait at all. */
  it('applies both turns concurrently when they touch different files', async () => {
    const app = project()
    const a = app.conversationOn('c1')
    const b = app.conversationOn('c2')

    await a.conversation.send('make it wider')
    await b.conversation.send('deepen the bracket')

    a.wire.receive(updated({ 'main.kcl': 'width = 20\n' }))
    b.wire.receive(updated({ 'bracket.kcl': 'depth = 4\n' }))

    expect(textOf(app.buffer('main.kcl'))).toBe('width = 20\n')
    expect(textOf(app.buffer('bracket.kcl'))).toBe('depth = 4\n')
    expect(a.conversation.transcript.value[0].waiting).toEqual([])
    expect(b.conversation.transcript.value[0].waiting).toEqual([])
  })

  /**
   * Same file: the second is held rather than refused, and says which file it is
   * waiting on. Interleaving them is what produced `depth = 332` in
   * `concurrentWriters.test.ts`, so waiting is the correct answer, not a
   * limitation.
   */
  it('holds the second writer on a file the first has claimed', async () => {
    const app = project()
    const a = app.conversationOn('c1')
    const b = app.conversationOn('c2')

    await a.conversation.send('make it wider')
    await b.conversation.send('make it wider too')

    a.wire.receive(updated({ 'main.kcl': 'width = 20\n' }))
    b.wire.receive(updated({ 'main.kcl': 'width = 30\n' }))

    expect(textOf(app.buffer('main.kcl'))).toBe('width = 20\n')
    expect(b.conversation.transcript.value[0].waiting).toEqual(['main.kcl'])
    // Waiting on a file, not blocked from talking: the turn is still live.
    expect(b.conversation.status.value).toBe('waiting')
  })
})
