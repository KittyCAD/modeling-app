import { deepStrictEqual } from 'node:assert'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { decode, encode } from '@msgpack/msgpack'
import type { Page, TestInfo } from '@playwright/test'
import { isArray } from '@src/lib/utils'

type Frame = { from: 'client' | 'engine'; wire: string; binary?: true }
type Session = Frame[]
const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i
const endpoint = '**/ws/modeling/commands**'

function unpack(frame: Frame): unknown {
  return frame.binary
    ? decode(Buffer.from(frame.wire, 'base64'))
    : JSON.parse(frame.wire)
}

function pack(from: Frame['from'], data: string | Buffer): Frame {
  if (typeof data !== 'string') {
    return { from, binary: true, wire: data.toString('base64') }
  }
  const value = JSON.parse(data)
  return {
    from,
    wire: JSON.stringify(
      value.type === 'headers' ? { type: 'headers' } : value
    ),
  }
}

function payloadType(frame: Frame): string | undefined {
  if (frame.binary) {
    return undefined
  }
  const data = JSON.parse(frame.wire)
  return data.resp?.type ?? data.type
}

class CassetteMismatch extends Error {}

async function readIfPresent(filename: string) {
  return readFile(filename, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      throw error
    }
    return undefined
  })
}

function visibilityBatchId(
  frame: Frame,
  isPlane: (id: string) => boolean
): string | undefined {
  if (frame.from !== 'client' || frame.binary) {
    return undefined
  }
  const data = JSON.parse(frame.wire)
  if (
    data.type === 'modeling_cmd_batch_req' &&
    data.requests.length > 0 &&
    data.requests.every(
      (request: { cmd: { type: string; object_id: string } }) =>
        request.cmd.type === 'object_visible' && isPlane(request.cmd.object_id)
    )
  ) {
    return data.batch_id
  }
  return undefined
}

function isSelectionCommand(frame: Frame) {
  if (frame.from !== 'client' || frame.binary) {
    return false
  }
  const type = JSON.parse(frame.wire).cmd?.type
  return (
    type === 'select_clear' || type === 'select_add' || type === 'select_get'
  )
}

function commandName(frame: Frame): string {
  const message = unpack(frame) as { type?: string; cmd?: { type: string } }
  return message.cmd?.type ?? message.type ?? 'unknown'
}

type EmptySelectionCommand = 'select_clear' | 'select_add' | 'select_get'

function emptySelectionRequest(frame: Frame) {
  if (frame.from !== 'client' || frame.binary) {
    return undefined
  }
  const { type, cmd_id: id, cmd } = JSON.parse(frame.wire)
  if (
    type !== 'modeling_cmd_req' ||
    typeof id !== 'string' ||
    !uuid.test(id) ||
    !cmd
  ) {
    return undefined
  }
  if (
    ((cmd.type === 'select_clear' || cmd.type === 'select_get') &&
      Object.keys(cmd).length === 1) ||
    (cmd.type === 'select_add' &&
      Object.keys(cmd).length === 2 &&
      isArray(cmd.entities) &&
      cmd.entities.length === 0)
  ) {
    return { id, type: cmd.type as EmptySelectionCommand }
  }
  return undefined
}

function emptySelectionReply(type: EmptySelectionCommand, id: string) {
  return {
    success: true,
    request_id: id,
    resp: {
      type: 'modeling',
      data: {
        modeling_response: {
          type,
          data: type === 'select_get' ? { entity_ids: [] } : {},
        },
      },
    },
  }
}

// An initially empty scene can synchronize its empty selection after its first
// execution. Leaving that exchange in the transcript makes the next execution
// depend on whether CodeMirror emitted a selection update during setup.
function emptyStartupSelection(frames: Session) {
  const requests = new Map<
    string,
    { index: number; type: EmptySelectionCommand }
  >()
  let opened = false
  let finishedEmptyExecution = false
  let end = 0

  for (const [index, frame] of frames.entries()) {
    if (frame.from !== 'client') {
      continue
    }
    if (frame.binary) {
      break
    }
    const message = JSON.parse(frame.wire)
    const type = message.cmd?.type ?? message.type
    switch (type) {
      case 'headers':
        break
      case 'begin_execution':
        if (opened) {
          end = index
        }
        opened = true
        break
      case 'end_execution':
        if (opened) {
          finishedEmptyExecution = true
        }
        break
      case 'set_kcl_version':
      case 'set_default_system_properties':
      case 'object_visible':
      case 'set_selection_filter':
        break
      case 'modeling_cmd_batch_req':
        if (
          !message.requests.every(
            (item: { cmd: { type: string } }) =>
              item.cmd.type === 'make_plane' ||
              item.cmd.type === 'object_visible'
          )
        ) {
          return undefined
        }
        break
      default: {
        const request = finishedEmptyExecution && emptySelectionRequest(frame)
        if (!request) {
          return undefined
        }
        requests.set(request.id, { index, type: request.type })
      }
    }
    if (end) {
      break
    }
  }
  if (!end || !finishedEmptyExecution) {
    return undefined
  }

  const indices = new Set([...requests.values()].map(({ index }) => index))
  for (const [index, frame] of frames.entries()) {
    if (frame.from !== 'engine' || frame.binary) {
      continue
    }
    const reply = JSON.parse(frame.wire)
    const request = requests.get(reply.request_id)
    if (!request) {
      continue
    }
    try {
      deepStrictEqual(
        reply,
        emptySelectionReply(request.type, reply.request_id)
      )
    } catch {
      return undefined
    }
    indices.add(index)
    requests.delete(reply.request_id)
  }
  return requests.size === 0 ? { indices, end } : undefined
}

export function replaySession(
  frames: Session,
  send: (data: string | Buffer) => void
) {
  const ids = new Map<string, string>()
  const assigned = new Set<string>()
  // Plane visibility updates can race with selection. Keep the batch and its
  // acknowledgement together while preserving the order of selection commands.
  const planes = new Set<string>()
  const visibility = new Map<
    string,
    { request: Frame; reply?: Frame; boundary: number }
  >()
  let boundary = 0
  const startup = emptyStartupSelection(frames)
  let optionalSelectionStart = -1
  let optionalSelectionEnd = -1
  const ordered = frames.filter((frame, i) => {
    if (startup && i === startup.end) {
      optionalSelectionEnd = boundary
    }
    if (startup?.indices.has(i)) {
      return false
    }
    const id = visibilityBatchId(frame, (id) => planes.has(id))
    if (id) {
      visibility.set(id, { request: frame, boundary })
      return false
    }
    if (frame.from === 'client' && !frame.binary) {
      const request = JSON.parse(frame.wire)
      if (request.type === 'modeling_cmd_batch_req') {
        for (const item of request.requests) {
          if (item.cmd.type === 'make_plane') {
            planes.add(item.cmd_id)
          }
        }
      }
    }
    if (frame.from === 'client' && !isSelectionCommand(frame)) {
      boundary++
      if (
        startup &&
        i < startup.end &&
        commandName(frame) === 'end_execution'
      ) {
        optionalSelectionStart = boundary
      }
    }
    if (frame.from === 'engine' && !frame.binary) {
      const reply = JSON.parse(frame.wire)
      const batch = visibility.get(reply.request_id)
      if (batch && (!reply.success || reply.resp?.type === 'modeling_batch')) {
        batch.reply = frame
        return false
      }
    }
    return true
  })
  const batches = visibility.values()
  let nextBatch = batches.next().value
  boundary = 0
  let index = 0

  function mapResponseId(value: string): string {
    if (!ids.has(value) && uuid.test(value)) {
      if (assigned.has(value)) {
        throw new CassetteMismatch('Engine entity ID collides with a client ID')
      }
      ids.set(value, value)
      assigned.add(value)
    }
    return ids.get(value) ?? value
  }

  function match(recorded: unknown, current: unknown): void {
    if (
      typeof recorded === 'string' &&
      uuid.test(recorded) &&
      typeof current === 'string' &&
      uuid.test(current)
    ) {
      if (!ids.has(recorded)) {
        deepStrictEqual(assigned.has(current), false, 'Engine UUID reused')
        ids.set(recorded, current)
        assigned.add(current)
      }
      deepStrictEqual(current, ids.get(recorded))
    } else if (isArray(recorded) && isArray(current)) {
      deepStrictEqual(current.length, recorded.length)
      recorded.forEach((item, i) => {
        match(item, current[i])
      })
    } else if (
      recorded &&
      current &&
      typeof recorded === 'object' &&
      typeof current === 'object' &&
      !isArray(recorded) &&
      !isArray(current)
    ) {
      const r = recorded as Record<string, unknown>
      const c = current as Record<string, unknown>
      deepStrictEqual(Object.keys(c).sort(), Object.keys(r).sort())
      for (const key of Object.keys(r)) {
        match(r[key], c[key])
      }
    } else {
      deepStrictEqual(current, recorded)
    }
  }

  function replace(value: unknown): unknown {
    if (typeof value === 'string') {
      return mapResponseId(value)
    }
    if (value instanceof Uint8Array) {
      if (value.length !== 16) {
        return value
      }
      const hex = Buffer.from(value).toString('hex')
      const id = hex.replace(
        /^(........)(....)(....)(....)(............)$/,
        '$1-$2-$3-$4-$5'
      )
      const actual = mapResponseId(id)
      return actual !== id
        ? new Uint8Array(Buffer.from(actual.replaceAll('-', ''), 'hex'))
        : value
    }
    if (isArray(value)) {
      return value.map(replace)
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          mapResponseId(key),
          replace(item),
        ])
      )
    }
    return value
  }

  function sendFrame(frame: Frame) {
    const value = replace(unpack(frame))
    send(frame.binary ? Buffer.from(encode(value)) : JSON.stringify(value))
  }

  function drain() {
    while (ordered[index]?.from === 'engine') {
      sendFrame(ordered[index++])
    }
  }

  drain()
  return {
    receive(frame: Frame) {
      if (payloadType(frame) === 'ping') {
        send(JSON.stringify({ success: true, resp: { type: 'pong' } }))
        return
      }
      if (
        visibilityBatchId(frame, (id) =>
          [...planes].some((plane) => ids.get(plane) === id)
        )
      ) {
        const batch = nextBatch
        if (!batch || boundary !== batch.boundary) {
          throw new CassetteMismatch('Unexpected visibility batch')
        }
        try {
          match(unpack(batch.request), unpack(frame))
        } catch (error) {
          throw new CassetteMismatch(
            'Engine cassette visibility batch mismatch',
            { cause: error }
          )
        }
        nextBatch = batches.next().value
        if (batch.reply) {
          sendFrame(batch.reply)
        }
        return
      }
      if (
        boundary >= optionalSelectionStart &&
        optionalSelectionStart >= 0 &&
        boundary <= optionalSelectionEnd
      ) {
        const optional = emptySelectionRequest(frame)
        if (optional) {
          send(JSON.stringify(emptySelectionReply(optional.type, optional.id)))
          return
        }
      }
      const expected = ordered[index]
      if (expected?.from !== 'client') {
        throw new CassetteMismatch(
          `Unexpected engine command at frame ${index}`
        )
      }
      try {
        match(unpack(expected), unpack(frame))
      } catch (error) {
        throw new CassetteMismatch(
          `Engine cassette mismatch at frame ${index}: expected ${commandName(expected)}, received ${commandName(frame)}. Use run-live-engine to refresh the cassette.`,
          { cause: error }
        )
      }
      if (!isSelectionCommand(frame)) {
        if (nextBatch?.boundary === boundary) {
          throw new CassetteMismatch(
            'Missing plane visibility batch before the next modeling command'
          )
        }
        boundary++
      }
      index++
      drain()
    },
    complete: () => index === ordered.length && !nextBatch,
  }
}

export async function installEngineCassette(page: Page, info: TestInfo) {
  const directory = process.env.ZDS_VCR_DIR
  if (!directory || !info.tags.includes('@vcr')) {
    return undefined
  }
  if (!info.tags.includes('@localRenderer')) {
    throw new Error('@vcr requires @localRenderer')
  }

  const key = createHash('sha256')
    .update(
      JSON.stringify([
        info.project.name,
        relative(info.project.testDir, info.file),
        ...info.titlePath,
      ])
    )
    .digest('hex')
  const filename = `${key}.json`
  const verifying = process.env.ZDS_VCR_VERIFY === '1'
  const state = process.env.ZDS_VCR_STATE
  const marker = state && join(state, `${key}-${info.repeatEachIndex}.retry`)
  const forcedLive = process.env.ZDS_VCR_LIVE === '1'
  const liveAttempt =
    marker && !verifying && !forcedLive
      ? await readIfPresent(marker)
      : undefined
  if (liveAttempt !== undefined && info.retry > Number(liveAttempt)) {
    throw new Error('The automatic live engine attempt already failed')
  }
  if (liveAttempt !== undefined) {
    info.annotations.push({
      type: 'engine-cassette',
      description: 'Live retry after cassette mismatch',
    })
  }

  const content =
    forcedLive || liveAttempt !== undefined
      ? undefined
      : await readIfPresent(join(directory, filename))
  if (verifying && content === undefined) {
    info.skip(true, 'This test did not produce a fresh cassette on this shard')
  }
  const recorded: Session[] | undefined =
    content === undefined ? undefined : JSON.parse(content)

  const sessions: Session[] = []
  const replays: ReturnType<typeof replaySession>[] = []
  let failure: Error | undefined
  console.log(
    `Engine cassette: ${recorded ? 'replay' : 'record'} (${info.title})`
  )
  await page.routeWebSocket(endpoint, (socket) => {
    if (recorded) {
      try {
        const frames = recorded[replays.length]
        if (!frames) {
          throw new CassetteMismatch(
            'Unexpected engine connection during cassette replay'
          )
        }
        const replay = replaySession(frames, (data) => socket.send(data))
        replays.push(replay)
        socket.onMessage((data) => {
          try {
            replay.receive(pack('client', data))
          } catch (error) {
            failure ??=
              error instanceof Error ? error : new Error(String(error))
            void socket.close()
          }
        })
      } catch (error) {
        failure ??= error instanceof Error ? error : new Error(String(error))
        void socket.close()
      }
      return
    }
    const frames: Session = []
    sessions.push(frames)
    const server = socket.connectToServer()
    socket.onMessage((data) => {
      const frame = pack('client', data)
      if (payloadType(frame) !== 'ping') {
        frames.push(frame)
      }
      server.send(data)
    })
    server.onMessage((data) => {
      const frame = pack('engine', data)
      if (payloadType(frame) !== 'pong') {
        frames.push(frame)
      }
      socket.send(data)
    })
  })
  return async (setupComplete: boolean) => {
    const mismatch =
      failure ??
      (setupComplete &&
      info.status === 'passed' &&
      recorded &&
      (recorded.length !== replays.length ||
        replays.some((replay) => !replay.complete()))
        ? new CassetteMismatch('Unused engine cassette frames or connections')
        : undefined)
    if (mismatch) {
      if (
        mismatch instanceof CassetteMismatch &&
        marker &&
        !verifying &&
        info.retry < info.project.retries
      ) {
        await writeFile(marker, String(info.retry + 1))
        info.annotations.push({
          type: 'engine-cassette',
          description: mismatch.message,
        })
        console.log(`Engine cassette: ${mismatch.message}. Retrying live.`)
      }
      throw mismatch
    }
    if (!setupComplete || info.status !== 'passed') {
      return
    }
    if (verifying && recorded) {
      await writeFile(join(directory, `${filename}.verified`), '')
      console.log(`Verified engine cassette ${filename} (${info.title})`)
    }
    if (!recorded) {
      if (
        !sessions.some((frames) =>
          frames.some((frame) => frame.from === 'engine')
        )
      ) {
        throw new Error('No engine responses captured')
      }
      const output = process.env.ZDS_VCR_RECORDINGS ?? directory
      await mkdir(output, { recursive: true })
      const temporary = join(output, `${key}.${randomUUID()}.tmp`)
      await writeFile(temporary, `${JSON.stringify(sessions, null, 2)}\n`)
      await rename(temporary, join(output, filename))
    }
  }
}
