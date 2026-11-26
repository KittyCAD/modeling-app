import { decode } from '@msgpack/msgpack'
import { ModelingResponseDecoder } from '@src/lib/engineConnection/compression'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const compressed = () =>
  Uint8Array.from(
    atob(
      'KLUv/WBiA/0CAEQFg6dzdWNjZXNzw6pyZXF1ZXN0X2lkxBABpHJlc3CCpHR5cGWmZXhwb3J0pGRhdGGBpWZpbGVzkYKkbmFtZaltb2RlbC5nbGKoY29udGVudHPFBAAqAgDMH1SQDowB'
    ),
    (char) => char.charCodeAt(0)
  ).buffer

class DecoderWorker {
  static instances: DecoderWorker[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() {
    DecoderWorker.instances.push(this)
  }
  reply(data: unknown) {
    this.onmessage?.({ data } as MessageEvent)
  }
}

describe('modeling response decoding', () => {
  const decoders: ModelingResponseDecoder[] = []
  beforeEach(() => {
    DecoderWorker.instances = []
    vi.stubGlobal('Worker', DecoderWorker)
  })
  afterEach(() => {
    decoders.splice(0).forEach((decoder) => decoder.dispose())
    vi.unstubAllGlobals()
  })
  const setup = () => {
    const deliver = vi.fn(),
      onError = vi.fn()
    const decoder = new ModelingResponseDecoder(deliver, onError)
    decoders.push(decoder)
    return { decoder, deliver, onError }
  }

  it('delivers existing text and MessagePack responses synchronously without a worker', () => {
    const { decoder, deliver } = setup()
    for (const data of [
      '{"success":true}',
      new Uint8Array([0x81, 0xa1, 0x61, 1]).buffer,
    ]) {
      const event = new MessageEvent('message', { data })
      decoder.handleMessage(event)
      expect(deliver).toHaveBeenLastCalledWith(event)
    }
    expect(DecoderWorker.instances).toHaveLength(0)
  })

  it('preserves mixed-message order while compressed responses decode and reuses one worker', () => {
    const { decoder, deliver, onError } = setup()
    const first = compressed(),
      second = compressed()
    decoder.handleMessage(new MessageEvent('message', { data: first }))
    const text = new MessageEvent('message', { data: 'pong' })
    decoder.handleMessage(text)
    decoder.handleMessage(new MessageEvent('message', { data: second }))
    const [worker] = DecoderWorker.instances
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith(first)
    expect(deliver).not.toHaveBeenCalled()
    const decoded = new Uint8Array([1, 2, 3]).buffer
    worker.reply({ data: decoded })
    expect(deliver.mock.calls.map(([event]) => event.data)).toEqual([
      decoded,
      text.data,
    ])
    expect(worker.postMessage).toHaveBeenLastCalledWith(second)
    worker.reply({ data: decoded })
    expect(deliver).toHaveBeenCalledTimes(3)
    expect(DecoderWorker.instances).toHaveLength(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('fails a corrupt response without delivering later queued messages', () => {
    const { decoder, deliver, onError } = setup()
    decoder.handleMessage(new MessageEvent('message', { data: compressed() }))
    decoder.handleMessage(new MessageEvent('message', { data: 'later' }))
    const [worker] = DecoderWorker.instances
    worker.reply({ error: 'Invalid Zstd frame' })
    decoder.handleMessage(
      new MessageEvent('message', { data: 'after failure' })
    )
    expect(onError).toHaveBeenCalledExactlyOnceWith(expect.any(Error))
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(deliver).not.toHaveBeenCalled()
  })

  it('drops late worker replies and errors after its connection is disposed', () => {
    const { decoder, deliver, onError } = setup()
    decoder.handleMessage(new MessageEvent('message', { data: compressed() }))
    const [worker] = DecoderWorker.instances
    decoder.dispose()
    worker.reply({ data: new ArrayBuffer(0) })
    worker.onerror?.({ message: 'late error' } as ErrorEvent)
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(deliver).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })
})

describe('Zstd worker interoperability', () => {
  let scope: {
    onmessage: ((event: MessageEvent) => void) | null
    postMessage: ReturnType<typeof vi.fn>
  }
  beforeEach(async () => {
    vi.resetModules()
    scope = { onmessage: null, postMessage: vi.fn() }
    vi.stubGlobal('self', scope)
    await import('@src/lib/engineConnection/decompress.worker')
  })
  afterEach(() => vi.unstubAllGlobals())

  it('decodes a standard Zstd MessagePack export and transfers the complete response', () => {
    scope.onmessage?.({ data: compressed() } as MessageEvent)
    const [response, options] = scope.postMessage.mock.calls[0]
    expect(decode(new Uint8Array(response.data))).toMatchObject({
      success: true,
      resp: {
        type: 'export',
        data: {
          files: [
            { name: 'model.glb', contents: new Uint8Array(1024).fill(42) },
          ],
        },
      },
    })
    expect(options.transfer).toEqual([response.data])
  })

  it('reports invalid frames and remains able to decode a subsequent response', () => {
    scope.onmessage?.({
      data: new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0xff]).buffer,
    } as MessageEvent)
    expect(scope.postMessage.mock.calls[0][0]).toEqual({
      error: expect.any(String),
    })
    scope.onmessage?.({ data: compressed() } as MessageEvent)
    expect(scope.postMessage.mock.calls[1][0].data).toBeInstanceOf(ArrayBuffer)
  })
})
