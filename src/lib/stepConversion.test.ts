import { readFileSync } from 'node:fs'
import { encode } from '@msgpack/msgpack'
import {
  type ConversionStorage,
  type StepConversion,
  StepConversionQueue,
  runStepConversion,
  validateConversionFiles,
} from '@src/lib/stepConversion'
import { validateNativeConversion } from '@src/lib/stepConversion'
import { getModule, reloadModule } from '@src/lib/wasm_lib_wrapper'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'

beforeAll(async () => {
  await reloadModule()
  getModule().initSync({ module: readFileSync('public/kcl_wasm_lib_bg.wasm') })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const source = () => new File(['ISO-10303-21;'], 'part.step')
const result = {
  files: { 'main.kcl': 'diameter = 4mm' },
  summary: 'Check the bore.',
}
const job = (status: StepConversion['status'] = 'queued'): StepConversion => ({
  id: 'job',
  ownerId: 'owner',
  projectPath: '/project',
  source: source(),
  status,
  attempts: 0,
})
function memory(initial: StepConversion[] = []): ConversionStorage {
  const saved = new Map(initial.map((item) => [item.id, item]))
  return {
    load: vi.fn(async (owner) =>
      [...saved.values()].filter((item) => item.ownerId === owner)
    ),
    put: vi.fn(async (item) => {
      saved.set(item.id, item)
    }),
  }
}

describe('application-owned STEP conversion queue', () => {
  test('serializes jobs and completes even with no subscribed pane', async () => {
    const first = deferred<typeof result>()
    const runner = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(result)
    const storage = memory()
    const queue = new StepConversionQueue(storage, runner)
    await queue.configure('owner', 'secret')
    const unsubscribe = queue.subscribe(vi.fn())
    await queue.enqueue('/original-project', source())
    await queue.enqueue('/second-project', source())
    unsubscribe()
    expect(queue.getSnapshot().map((item) => item.status)).toEqual([
      'running',
      'queued',
    ])
    expect(runner).toHaveBeenCalledTimes(1)
    first.resolve(result)
    await vi.waitFor(() =>
      expect(queue.getSnapshot().map((item) => item.status)).toEqual([
        'completed',
        'completed',
      ])
    )
    expect(queue.getSnapshot()[0]).toMatchObject({
      projectPath: '/original-project',
      attempts: 1,
      ...result,
    })
    expect(JSON.stringify(await storage.load('owner'))).not.toContain('secret')
  })

  test('reload preserves completed results and requires explicit retry after interruption', async () => {
    const storage = memory([
      job('running'),
      { ...job('completed'), id: 'finished', files: result.files },
    ])
    const runner = vi.fn().mockResolvedValue(result)
    const queue = new StepConversionQueue(storage, runner)
    await queue.configure('owner', 'token')
    expect(queue.getSnapshot()[0]).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('interrupted'),
    })
    expect(queue.getSnapshot()[1]).toMatchObject({
      status: 'completed',
      files: result.files,
    })
    expect(runner).not.toHaveBeenCalled()
    await queue.retry('job')
    await vi.waitFor(() =>
      expect(queue.getSnapshot()[0].status).toBe('completed')
    )
    expect(runner).toHaveBeenCalledTimes(1)
  })

  test('failed attempts retain the source and retry only on request', async () => {
    const runner = vi
      .fn()
      .mockRejectedValueOnce(new Error('Connection lost'))
      .mockResolvedValue(result)
    const queue = new StepConversionQueue(memory(), runner)
    await queue.configure('owner', 'token')
    await queue.enqueue('/project', source())
    await vi.waitFor(() => expect(queue.getSnapshot()[0].status).toBe('failed'))
    expect(queue.getSnapshot()[0].error).toBe('Connection lost')
    expect(runner).toHaveBeenCalledTimes(1)
    await queue.retry(queue.getSnapshot()[0].id)
    await vi.waitFor(() =>
      expect(queue.getSnapshot()[0].status).toBe('completed')
    )
    expect(queue.getSnapshot()[0].attempts).toBe(2)
  })

  test('signing out aborts the active attempt and hides the previous account', async () => {
    const completion = deferred<typeof result>()
    const runner = vi.fn().mockReturnValue(completion.promise)
    const queue = new StepConversionQueue(memory(), runner)
    await queue.configure('owner', 'token')
    await queue.enqueue('/project', source())
    await vi.waitFor(() => expect(runner).toHaveBeenCalledOnce())
    const signal = runner.mock.calls[0][2] as AbortSignal
    await queue.configure('', '')
    expect(signal.aborted).toBe(true)
    completion.resolve(result)
    await vi.waitFor(() => expect(queue.getSnapshot()).toEqual([]))
    await queue.configure('different-owner', 'other-token')
    expect(queue.getSnapshot()).toEqual([])
  })

  test('a token refresh does not abort the current conversion', async () => {
    const completion = deferred<typeof result>()
    const runner = vi.fn().mockReturnValue(completion.promise)
    const queue = new StepConversionQueue(memory(), runner)
    await queue.configure('owner', 'token')
    await queue.enqueue('/project', source())
    await vi.waitFor(() => expect(runner).toHaveBeenCalledOnce())
    await queue.configure('owner', 'new-token')
    expect((runner.mock.calls[0][2] as AbortSignal).aborted).toBe(false)
    completion.resolve(result)
    await vi.waitFor(() =>
      expect(queue.getSnapshot()[0].status).toBe('completed')
    )
  })

  test('does not spend credits if saving the source fails', async () => {
    const storage = memory()
    vi.mocked(storage.put).mockRejectedValue(new Error('Storage full'))
    const runner = vi.fn()
    const queue = new StepConversionQueue(storage, runner)
    await queue.configure('owner', 'token')
    await expect(queue.enqueue('/project', source())).rejects.toThrow(
      'Storage full'
    )
    expect(runner).not.toHaveBeenCalled()
  })

  test('keeps the paid result available when persistent storage fills up', async () => {
    const storage = memory()
    const queue = new StepConversionQueue(storage, async () => {
      vi.mocked(storage.put).mockRejectedValue(new Error('Storage full'))
      return result
    })
    await queue.configure('owner', 'token')
    await queue.enqueue('/project', source())
    await vi.waitFor(() =>
      expect(queue.getSnapshot()[0].status).toBe('completed')
    )
    expect(queue.getSnapshot()[0]).toMatchObject({
      ...result,
      error: expect.stringContaining('Open KCL'),
    })
    await queue.savePath(queue.getSnapshot()[0].id, '/project/saved/main.kcl')
    expect(queue.getSnapshot()[0].savedPath).toBe('/project/saved/main.kcl')
  })
})

describe('conversion output boundary', () => {
  test('rejects imported geometry, missing modules, and external imports using the KCL parser', () => {
    for (const code of [
      'import "source.step" as part',
      'import "missing.kcl" as part',
      'import "../external.kcl" as part',
    ]) {
      expect(() => validateNativeConversion({ 'main.kcl': code })).toThrow()
    }
    expect(() =>
      validateNativeConversion({
        'main.kcl': 'import "parts/main.kcl" as bore',
        'parts/main.kcl': 'export diameter = 4mm',
      })
    ).not.toThrow()
  })
  test.each([
    '../escape.kcl',
    '/absolute.kcl',
    'C:/absolute.kcl',
    'sub\\escape.kcl',
    'source.step',
    './main.kcl',
  ])('rejects %s', (path) => {
    expect(() =>
      validateConversionFiles({ ...result.files, [path]: 'x' })
    ).toThrow()
  })
  test('requires a nonempty entrypoint and permits nested native files', () => {
    expect(() => validateConversionFiles({ 'main.kcl': ' ' })).toThrow()
    expect(
      validateConversionFiles({
        ...result.files,
        'parts/bore.kcl': 'bore = 4mm',
      })
    ).toHaveProperty('parts/bore.kcl')
  })
})

class FakeSocket {
  static OPEN = 1
  static instances: FakeSocket[] = []
  readyState = 1
  binaryType = ''
  onopen?: () => void
  onclose?: () => void
  onerror?: () => void
  onmessage?: (event: { data: string | ArrayBuffer }) => void
  sent: Record<string, unknown>[] = []
  constructor() {
    FakeSocket.instances.push(this)
  }
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close() {
    this.readyState = 3
    this.onclose?.()
  }
  message(data: unknown, binary = false) {
    const packed = encode(data)
    this.onmessage?.({
      data: binary ? packed.slice().buffer : JSON.stringify(data),
    })
  }
}

describe('conversion WebSocket lifecycle', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    FakeSocket.instances = []
  })
  async function start() {
    vi.stubGlobal('WebSocket', FakeSocket)
    const controller = new AbortController()
    const pending = runStepConversion(job(), 'token', controller.signal)
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
    const socket = FakeSocket.instances[0]
    socket.onopen?.()
    socket.message({ conversation_id: 'conversation' })
    return { pending, socket, controller }
  }
  test('sends isolated source bytes and retains the final snapshot and notes', async () => {
    const { pending, socket } = await start()
    expect(socket.sent[0]).toMatchObject({
      type: 'headers',
      headers: { Authorization: 'Bearer token' },
    })
    expect(socket.sent[1]).toMatchObject({
      type: 'user',
      current_files: { 'main.kcl': [] },
      additional_files: [{ name: 'part.step' }],
    })
    socket.message(
      {
        tool_output: {
          result: {
            type: 'edit_kcl_code',
            status_code: 200,
            outputs: result.files,
          },
        },
      },
      true
    )
    socket.message({ end_of_stream: { whole_response: result.summary } })
    await expect(pending).resolves.toEqual(result)
    expect(socket.readyState).toBe(3)
  })
  test('a dropped connection fails instead of treating partial output as complete', async () => {
    const { pending, socket } = await start()
    const rejected = expect(pending).rejects.toThrow('lost')
    socket.message({
      tool_output: {
        result: {
          type: 'edit_kcl_code',
          status_code: 200,
          outputs: result.files,
        },
      },
    })
    socket.close()
    await rejected
  })
  test('an execution failure invalidates an earlier successful snapshot', async () => {
    const { pending, socket } = await start()
    const rejected = expect(pending).rejects.toThrow('without a KCL result')
    socket.message({
      tool_output: {
        result: {
          type: 'edit_kcl_code',
          status_code: 200,
          outputs: result.files,
        },
      },
    })
    socket.message({
      tool_output: {
        result: { type: 'edit_kcl_code', status_code: 400, error: 'bad KCL' },
      },
    })
    socket.message({ end_of_stream: {} })
    await rejected
  })
  test('aborting sends cancellation and rejects the pending conversion', async () => {
    const { pending, socket, controller } = await start()
    const rejected = expect(pending).rejects.toThrow('interrupted')
    controller.abort()
    await rejected
    expect(socket.sent.at(-1)).toEqual({ type: 'system', command: 'cancel' })
  })
})
