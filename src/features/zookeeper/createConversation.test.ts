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

const PATH = 'main.kcl'
const BASE = 'width = 10\n'
const AUTHOR = 'zookeeper:c1'

const historyCapability: EditorCapability = {
  id: 'history',
  extension: () => history(),
}

const textOf = (buffer: FileBackedTextBuffer) =>
  buffer.state.peek().doc.toString()

/** A transport a test drives by hand. */
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

function setup(options: { contents?: string; withClaims?: boolean } = {}) {
  const buffer = createFileBackedTextBuffer({
    path: PATH,
    contents: options.contents ?? BASE,
    languageId: 'kcl',
    capabilities: combineCapabilities([historyCapability]),
  })
  const target: ApplyTarget = {
    bufferForPath: (path) => (path === PATH ? buffer : undefined),
    executingBufferId: () => null,
  }
  const wire = fakeTransport()
  const changeHistory = createChangeHistory()
  const claims = options.withClaims ? createWriteClaims() : undefined

  const conversation = createConversation({
    id: 'c1',
    author: AUTHOR,
    transport: wire.transport,
    target,
    changeHistory,
    ...(claims === undefined ? {} : { claims }),
    captureProject: async () => new Map([[PATH, textOf(buffer)]]),
  })

  return { buffer, target, wire, changeHistory, claims, conversation }
}

const output = (contents: string): MlCopilotServerMessage => ({
  project_updated: { files: { [PATH]: contents } },
})

const endOfStream: MlCopilotServerMessage = { end_of_stream: {} }

describe('createConversation', () => {
  it('is idle with nothing in the transcript', async () => {
    const { conversation } = setup()

    expect(conversation.status.value).toBe('idle')
    expect(conversation.transcript.value).toEqual([])
  })

  it('sends the prompt with the project as it stands', async () => {
    const { wire, conversation } = setup()

    await conversation.send('make it wider')

    expect(wire.sent).toHaveLength(1)
    const message = wire.sent[0]
    expect(message.type).toBe('user')
    if (message.type !== 'user') return
    expect(message.content).toBe('make it wider')
    // Byte arrays, as the protocol wants.
    expect(message.current_files?.[PATH]).toEqual(
      Array.from(new TextEncoder().encode(BASE))
    )
  })

  it('accumulates streamed text onto the turn', async () => {
    const { wire, conversation } = setup()
    await conversation.send('make it wider')

    wire.receive({ delta: { delta: 'Making ' } })
    wire.receive({ delta: { delta: 'it wider.' } })

    expect(conversation.transcript.value[0].response).toBe('Making it wider.')
    expect(conversation.status.value).toBe('streaming')
  })

  /**
   * Reasoning is its own field, not folded into the response. `delta` is the
   * answer; this is the route to it, and the pane collapses one without hiding
   * the other.
   */
  it('collects streamed reasoning separately from the response', async () => {
    const { wire, conversation } = setup()
    await conversation.send('make it wider')

    wire.receive({ reasoning: { type: 'text', content: 'Looking at ' } })
    wire.receive({ reasoning: { type: 'text', content: 'the wall.' } })
    wire.receive({
      reasoning: {
        type: 'design_plan',
        steps: [{ filepath_to_edit: PATH, edit_instructions: 'Widen it' }],
      },
    })
    wire.receive({ delta: { delta: 'Widening.' } })

    const turn = conversation.transcript.value[0]
    expect(turn.response).toBe('Widening.')
    expect(turn.reasoning).toEqual([
      { kind: 'text', content: 'Looking at the wall.' },
      { kind: 'plan', steps: [{ path: PATH, instructions: 'Widen it' }] },
    ])
  })

  it('ignores a reasoning message it cannot read', async () => {
    const { wire, conversation } = setup()
    await conversation.send('make it wider')

    wire.receive({ reasoning: { type: 'text', content: '' } })

    expect(conversation.transcript.value[0].reasoning).toEqual([])
  })

  /**
   * The turn-id guard applies here too: a reasoning frame from an interrupted
   * turn must not append to whatever is running now.
   */
  it('drops reasoning that arrives after the turn was interrupted', async () => {
    const { wire, conversation } = setup()
    await conversation.send('make it wider')
    conversation.interrupt()

    wire.receive({ reasoning: { type: 'text', content: 'still thinking' } })

    expect(conversation.transcript.value[0].reasoning).toEqual([])
  })

  it('applies a mid-turn output to the buffer, attributed', async () => {
    const { buffer, wire, conversation } = setup()
    const seen: (string | undefined)[] = []
    buffer.onChange((change) => seen.push(change.author))

    await conversation.send('make it wider')
    wire.receive(output('width = 24\n'))

    expect(textOf(buffer)).toBe('width = 24\n')
    expect(seen).toEqual([AUTHOR])
    expect(conversation.transcript.value[0].paths).toEqual([PATH])
  })

  it('completes the turn on end of stream', async () => {
    const { wire, conversation } = setup()
    await conversation.send('make it wider')
    wire.receive(output('width = 24\n'))
    wire.receive(endOfStream)

    expect(conversation.transcript.value[0].status).toBe('complete')
    expect(conversation.status.value).toBe('idle')
  })

  /**
   * Streaming, and the reason the view has to advance as each output lands: the
   * second output describes a document built on the first, so diffing it against
   * the start of the turn would re-apply the first output's work.
   */
  it('applies two outputs in one turn without double-applying', async () => {
    const { buffer, wire, conversation } = setup()
    await conversation.send('add two lines')

    wire.receive(output('width = 10\ndepth = 2\n'))
    wire.receive(output('width = 10\ndepth = 2\nheight = 4\n'))
    wire.receive(endOfStream)

    const text = textOf(buffer)
    expect(text).toBe('width = 10\ndepth = 2\nheight = 4\n')
    expect(text.match(/depth = 2/g)).toHaveLength(1)
  })

  it('rebases an output around typing that happened while it streamed', async () => {
    const { buffer, wire, conversation } = setup({
      contents: 'width = 10\ndepth = 2\n',
    })
    await conversation.send('change depth')

    // The user prepends a line mid-turn.
    buffer.dispatch({ changes: { from: 0, insert: '// mine\n' } })
    wire.receive(output('width = 10\ndepth = 7\n'))
    wire.receive(endOfStream)

    expect(textOf(buffer)).toBe('// mine\nwidth = 10\ndepth = 7\n')
  })

  it('records a conflict without writing, when the user got there first', async () => {
    const { buffer, wire, conversation } = setup({
      contents: 'width = 10\ndepth = 2\n',
    })
    await conversation.send('change depth')

    // The user rewrites the very line the service is about to.
    buffer.dispatch({ changes: { from: 11, to: 20, insert: 'depth = 99' } })
    wire.receive(output('width = 10\ndepth = 7\n'))

    expect(conversation.conflicts.value).toHaveLength(1)
    expect(textOf(buffer)).toContain('depth = 99')
  })

  /**
   * **The rule that makes live-apply safe to cancel.** Aborting stops us waiting
   * but cannot stop a frame already in flight, and without the turn check a late
   * output would write to the file *after* the user asked us to stop.
   */
  it('ignores an output that arrives after the turn was interrupted', async () => {
    const { buffer, wire, conversation } = setup()
    await conversation.send('make it wider')
    conversation.interrupt()

    wire.receive(output('width = 24\n'))

    expect(textOf(buffer)).toBe(BASE)
    expect(conversation.transcript.value[0].status).toBe('interrupted')
  })

  it('tells the service to stop as well as stopping itself', async () => {
    const { wire, conversation } = setup()
    await conversation.send('make it wider')
    conversation.interrupt()

    const last = wire.sent.at(-1)
    expect(last?.type).toBe('system')
    if (last?.type !== 'system') return
    expect(last.command).toBe('interrupt')
  })

  it('ignores an output arriving after the stream already ended', async () => {
    const { buffer, wire, conversation } = setup()
    await conversation.send('make it wider')
    wire.receive(endOfStream)

    wire.receive(output('width = 24\n'))

    expect(textOf(buffer)).toBe(BASE)
  })

  it('fails the turn on an error, without writing', async () => {
    const { buffer, wire, conversation } = setup()
    await conversation.send('make it wider')

    wire.receive({ error: { detail: 'the model gave up' } })

    expect(conversation.transcript.value[0].status).toBe('failed')
    expect(conversation.status.value).toBe('failed')
    expect(textOf(buffer)).toBe(BASE)
  })

  it('does not apply the outputs of a tool that failed', async () => {
    const { buffer, wire, conversation } = setup()
    await conversation.send('make it wider')

    wire.receive({
      tool_output: {
        result: {
          type: 'edit_kcl_code',
          status_code: 500,
          outputs: { [PATH]: 'width = 24\n' },
        },
      },
    })

    expect(textOf(buffer)).toBe(BASE)
    expect(conversation.transcript.value[0].status).toBe('failed')
  })

  it('supersedes a turn still running when a new prompt arrives', async () => {
    const { wire, conversation } = setup()
    await conversation.send('first')
    await conversation.send('second')

    const transcript = conversation.transcript.value
    expect(transcript).toHaveLength(2)
    expect(transcript[0].status).toBe('interrupted')
    expect(transcript[1].status).toBe('streaming')
    // The service was told to stop the first one.
    expect(wire.sent.some((message) => message.type === 'system')).toBe(true)
  })

  /**
   * Capturing the project reads the disk, so a turn can be superseded while it is
   * happening. Sending anyway would have the service work on a question the user
   * has already replaced.
   */
  it('does not send a turn superseded while the project was being read', async () => {
    const buffer = createFileBackedTextBuffer({
      path: PATH,
      contents: BASE,
      languageId: 'kcl',
      capabilities: combineCapabilities([historyCapability]),
    })
    const target: ApplyTarget = {
      bufferForPath: (path) => (path === PATH ? buffer : undefined),
      executingBufferId: () => null,
    }
    const wire = fakeTransport()

    // Held open so the test controls when the "disk" answers.
    let release = () => {}
    const reading = new Promise<ReadonlyMap<string, string>>((resolve) => {
      release = () => resolve(new Map([[PATH, BASE]]))
    })

    const conversation = createConversation({
      id: 'c1',
      author: AUTHOR,
      transport: wire.transport,
      target,
      changeHistory: createChangeHistory(),
      captureProject: () => reading,
    })

    const first = conversation.send('first')
    // Superseded before the disk came back.
    conversation.interrupt()
    release()
    await first

    // No prompt went out for the abandoned turn.
    expect(wire.sent.filter((message) => message.type === 'user')).toEqual([])
    expect(conversation.transcript.value[0].status).toBe('interrupted')
  })

  it('reverts one turn, keeping what the user did after it', async () => {
    const { buffer, wire, conversation } = setup()
    await conversation.send('add a line')
    wire.receive(output('width = 10\ndepth = 2\n'))
    wire.receive(endOfStream)

    buffer.dispatch({ changes: { from: 0, insert: '// mine\n' } })

    const turnId = conversation.transcript.value[0].id
    conversation.revert(turnId)

    expect(textOf(buffer)).toBe('// mine\nwidth = 10\n')
  })

  /**
   * The second half of the claim lesson, at the level the conversation has to
   * honour it: a held path's view is stale by definition, so it is dropped rather
   * than kept for a replay.
   */
  it('drops its view of a path another writer is holding', async () => {
    const { buffer, wire, conversation, claims } = setup({ withClaims: true })
    expect(claims).toBeDefined()
    if (claims === undefined) return

    // Somebody else is mid-turn on the file.
    claims.claim(PATH, 'zookeeper:c2')

    await conversation.send('make it wider')
    wire.receive(output('width = 24\n'))

    expect(textOf(buffer)).toBe(BASE)
    const turn = conversation.transcript.value[0]
    expect(turn.waiting).toEqual([PATH])
    expect(turn.status).toBe('waiting')

    // And it says so at the top level, which is what the pane renders.
    expect(conversation.status.value).toBe('waiting')

    // Ending the stream does not turn a held turn into a completed one.
    wire.receive(endOfStream)
    expect(conversation.transcript.value[0].status).toBe('waiting')
    expect(conversation.status.value).toBe('waiting')
  })

  it('releases its claims when a turn ends', async () => {
    const { wire, conversation, claims } = setup({ withClaims: true })
    if (claims === undefined) return

    await conversation.send('make it wider')
    wire.receive(output('width = 24\n'))
    expect(claims.holder(PATH)).toBe(AUTHOR)

    wire.receive(endOfStream)
    expect(claims.holder(PATH)).toBeNull()
  })

  it('stops listening and releases everything on dispose', async () => {
    const { buffer, wire, conversation, claims } = setup({ withClaims: true })
    if (claims === undefined) return

    await conversation.send('make it wider')
    wire.receive(output('width = 24\n'))
    conversation.dispose()

    wire.receive(output('width = 99\n'))

    expect(textOf(buffer)).toBe('width = 24\n')
    expect(claims.holder(PATH)).toBeNull()
  })
})
