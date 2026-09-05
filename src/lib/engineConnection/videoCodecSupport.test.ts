import {
  ENGINE_SUPPORTED_VIDEO_CODECS,
  getEngineVideoCodecSupport,
  getVideoCodecsFromSdp,
  isUnsupportedEngineVideoCodecError,
  preflightEngineVideoCodecSupport,
  UnsupportedEngineVideoCodecError,
} from '@src/lib/engineConnection/videoCodecSupport'
import { afterEach, describe, expect, test, vi } from 'vitest'

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

describe('Engine video codec support', () => {
  test('accepts a browser that offers the Engine H.264 stream codec', () => {
    expect(getEngineVideoCodecSupport(['video/VP8', 'video/H264'])).toEqual({
      status: 'supported',
      browserCodecs: ['video/vp8', 'video/h264'],
      engineCodecs: ENGINE_SUPPORTED_VIDEO_CODECS,
    })
  })

  test('normalizes MIME type case', () => {
    expect(getEngineVideoCodecSupport(['VIDEO/h264']).status).toBe('supported')
  })

  test('rejects a browser with no codec the Engine can produce', () => {
    expect(
      getEngineVideoCodecSupport(['video/VP8', 'video/VP9', 'video/AV1'])
    ).toEqual({
      status: 'unsupported',
      browserCodecs: ['video/vp8', 'video/vp9', 'video/av1'],
      engineCodecs: ENGINE_SUPPORTED_VIDEO_CODECS,
    })
  })

  test('allows normal negotiation when local SDP preflight is unavailable', () => {
    expect(getEngineVideoCodecSupport(undefined)).toEqual({
      status: 'unknown',
      browserCodecs: [],
      engineCodecs: ENGINE_SUPPORTED_VIDEO_CODECS,
    })
  })

  test('extracts only codecs from the SDP video section', () => {
    const sdp = [
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'a=rtpmap:111 opus/48000/2',
      'm=video 9 UDP/TLS/RTP/SAVPF 96 97 98',
      'a=rtpmap:96 VP8/90000',
      'a=rtpmap:97 H264/90000',
      'a=rtpmap:98 rtx/90000',
    ].join('\r\n')

    expect(getVideoCodecsFromSdp(sdp)).toEqual([
      'video/vp8',
      'video/h264',
      'video/rtx',
    ])
  })

  test('returns a terminal error for a local offer without H.264', async () => {
    const close = stubLocalOffer(
      [
        'm=video 9 UDP/TLS/RTP/SAVPF 96 97',
        'a=rtpmap:96 VP8/90000',
        'a=rtpmap:97 VP9/90000',
      ].join('\r\n')
    )

    await expect(preflightEngineVideoCodecSupport()).resolves.toBeInstanceOf(
      UnsupportedEngineVideoCodecError
    )
    expect(close).toHaveBeenCalledOnce()
  })

  test('accepts and closes a local preflight offer with H.264', async () => {
    const close = stubLocalOffer(
      ['m=video 9 UDP/TLS/RTP/SAVPF 96', 'a=rtpmap:96 H264/90000'].join('\r\n')
    )

    await expect(preflightEngineVideoCodecSupport()).resolves.toMatchObject({
      status: 'supported',
    })
    expect(close).toHaveBeenCalledOnce()
  })

  test('identifies unsupported codec errors as terminal', () => {
    const error = new UnsupportedEngineVideoCodecError(['video/vp8'])

    expect(isUnsupportedEngineVideoCodecError(error)).toBe(true)
    expect(isUnsupportedEngineVideoCodecError(new Error('temporary'))).toBe(
      false
    )
  })
})
