import {
  ENGINE_SUPPORTED_VIDEO_CODECS,
  preflightEngineVideoCodecSupport,
  UnsupportedEngineVideoCodecError,
} from '@src/lib/engineConnection/videoCodecSupport'
import { EngineConnectionErrorKind } from '@src/lib/engineConnection/utils'
import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
})

const stubLocalOffer = (sdp: string) => {
  const close = vi.fn()
  vi.stubGlobal(
    'RTCPeerConnection',
    class {
      addTransceiver = vi.fn()
      close = close
      createOffer = vi.fn().mockResolvedValue({ type: 'offer', sdp })
    }
  )
  return close
}

test('accepts and closes an offer containing H.264', async () => {
  const close = stubLocalOffer(
    ['m=video 9 UDP/TLS/RTP/SAVPF 96', 'a=rtpmap:96 H264/90000'].join('\r\n')
  )

  await expect(preflightEngineVideoCodecSupport()).resolves.toBeUndefined()
  expect(close).toHaveBeenCalledOnce()
})

test('normalizes codec names before comparison', async () => {
  const close = stubLocalOffer(
    ['m=video 9 UDP/TLS/RTP/SAVPF 96', 'a=rtpmap:96 h264/90000'].join('\r\n')
  )

  await expect(preflightEngineVideoCodecSupport()).resolves.toBeUndefined()
  expect(close).toHaveBeenCalledOnce()
})

test('returns a typed terminal error when the offer lacks H.264', async () => {
  const close = stubLocalOffer(
    [
      'm=video 9 UDP/TLS/RTP/SAVPF 96 97',
      'a=rtpmap:96 VP8/90000',
      'a=rtpmap:97 VP9/90000',
    ].join('\r\n')
  )

  const result = await preflightEngineVideoCodecSupport()

  expect(result).toBeInstanceOf(UnsupportedEngineVideoCodecError)
  expect(result).toMatchObject({
    kind: EngineConnectionErrorKind.UnsupportedVideoCodec,
    terminal: true,
    browserCodecs: ['video/vp8', 'video/vp9'],
    engineCodecs: ENGINE_SUPPORTED_VIDEO_CODECS,
  })
  expect(close).toHaveBeenCalledOnce()
})

test('falls back to normal negotiation when preflight is unavailable', async () => {
  vi.stubGlobal('RTCPeerConnection', undefined)

  await expect(preflightEngineVideoCodecSupport()).resolves.toBeUndefined()
})
