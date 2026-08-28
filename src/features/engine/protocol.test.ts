import { describe, expect, it } from 'vitest'
import {
  clampDimension,
  streamDimensionsFor,
  engineWebSocketUrl,
  errorFromMessage,
  isAuthError,
  peerConfiguration,
  toSessionDescription,
} from '@src/features/engine/protocol'

describe('errorFromMessage', () => {
  it('returns nothing for a successful message', () => {
    expect(errorFromMessage({ success: true })).toBeNull()
    expect(errorFromMessage({ resp: { type: 'pong' } })).toBeNull()
  })

  it('reads the first error', () => {
    expect(
      errorFromMessage({
        success: false,
        errors: [{ error_code: 'auth_token_invalid', message: 'nope' }],
      })
    ).toEqual({ code: 'auth_token_invalid', message: 'nope' })
  })

  it('still reports a failure with no error detail', () => {
    // A rejection with no body must not read as success.
    const error = errorFromMessage({ success: false })
    expect(error?.code).toBe('unknown')
    expect(error?.message).toBeTruthy()
  })

  it('recognises the auth failures worth naming', () => {
    // Without this, an expired token looks like a network problem and sends
    // people to check their wifi.
    expect(isAuthError({ code: 'auth_token_invalid', message: '' })).toBe(true)
    expect(isAuthError({ code: 'unauthorized', message: '' })).toBe(true)
    expect(isAuthError({ code: 'internal', message: '' })).toBe(false)
  })
})

describe('engineWebSocketUrl', () => {
  it('always carries the stream dimensions', () => {
    const url = new URL(
      engineWebSocketUrl({
        baseUrl: 'wss://api.example.dev/ws/modeling/commands',
        width: 1024,
        height: 768,
      })
    )

    expect(url.searchParams.get('video_res_width')).toBe('1024')
    expect(url.searchParams.get('video_res_height')).toBe('768')
  })

  it('carries no scene parameters of its own', () => {
    const url = new URL(
      engineWebSocketUrl({
        baseUrl: 'wss://api.example.dev/ws/modeling/commands',
        width: 1024,
        height: 768,
      })
    )

    // Which post effects and overlays the scene wants belongs to whoever owns
    // those preferences; the connection only carries what it is handed.
    expect(url.searchParams.get('post_effect')).toBeNull()
    expect(url.searchParams.get('show_grid')).toBeNull()
  })

  it('merges contributed scene parameters', () => {
    const url = new URL(
      engineWebSocketUrl({
        baseUrl: 'wss://api.example.dev/ws/modeling/commands',
        width: 1024,
        height: 768,
        params: { post_effect: 'ssao', show_grid: 'false' },
      })
    )

    expect(url.searchParams.get('post_effect')).toBe('ssao')
    expect(url.searchParams.get('show_grid')).toBe('false')
  })

  it('does not let a parameter overwrite the stream dimensions', () => {
    const url = new URL(
      engineWebSocketUrl({
        baseUrl: 'wss://api.example.dev/ws/modeling/commands',
        width: 1024,
        height: 768,
        params: { video_res_width: '99999' },
      })
    )

    // A dimension the engine refuses closes the socket with no explanation, so
    // the clamped values are not something a contribution gets to override.
    expect(url.searchParams.get('video_res_width')).toBe('1024')
  })

  it('appends to a base URL that already has a query', () => {
    const url = engineWebSocketUrl({
      baseUrl: 'wss://api.example.dev/ws?replay=1',
      width: 256,
      height: 256,
    })
    expect(url).toContain('replay=1&')
    expect(url.match(/\?/g)).toHaveLength(1)
  })
})

describe('streamDimensionsFor', () => {
  it('leaves an ordinary panel alone, rounded to the engine’s granularity', () => {
    expect(streamDimensionsFor(1201, 799)).toEqual({ width: 1200, height: 800 })
  })

  it('scales a large panel down without changing its shape', () => {
    // Clamping each axis on its own gives 2160x2160 for this, and the viewport
    // then letterboxes a scene that is the wrong shape.
    const size = streamDimensionsFor(4000, 3000)
    expect(size.width).toBe(2160)
    expect(size.height).toBe(1620)
  })

  it('scales a tiny panel up without changing its shape', () => {
    const size = streamDimensionsFor(100, 80)
    expect(size.height).toBe(256)
    expect(size.width / size.height).toBeCloseTo(100 / 80, 2)
  })

  it('keeps an extreme panel inside both bounds', () => {
    const size = streamDimensionsFor(3000, 200)
    expect(size.width).toBeLessThanOrEqual(2160)
    expect(size.height).toBeGreaterThanOrEqual(256)
    expect(size.width % 4).toBe(0)
    expect(size.height % 4).toBe(0)
  })

  it('answers with something valid for a panel that has not laid out', () => {
    expect(streamDimensionsFor(0, 0)).toEqual({ width: 256, height: 256 })
    expect(streamDimensionsFor(Number.NaN, 100)).toEqual({
      width: 256,
      height: 256,
    })
  })
})

describe('clampDimension', () => {
  it('rejects a measurement taken before layout', () => {
    // Measuring an element before it lays out yields 0, and the engine refuses
    // the connection rather than clamping — which looks like an outage.
    expect(clampDimension(0)).toBe(256)
    expect(clampDimension(Number.NaN)).toBe(256)
    expect(clampDimension(-10)).toBe(256)
  })

  it('rounds to a multiple of four, which the engine requires', () => {
    // Not merely even. A 594px panel produced a size the engine refused by
    // closing the socket with no explanation.
    expect(clampDimension(594)).toBe(596)
    expect(clampDimension(838)).toBe(840)
    for (const value of [257, 600, 1023, 1025, 1919]) {
      expect(clampDimension(value) % 4).toBe(0)
    }
  })

  it('clamps to the supported range', () => {
    expect(clampDimension(100)).toBe(256)
    expect(clampDimension(10_000)).toBe(2160)
  })
})

describe('peerConfiguration', () => {
  it('forces relay when ICE servers are supplied', () => {
    const configuration = peerConfiguration([{ urls: 'turn:example' }])
    // The engine's topology is known; direct connections are not negotiated.
    expect(configuration.iceTransportPolicy).toBe('relay')
    expect(configuration.bundlePolicy).toBe('max-bundle')
  })

  it('does not force relay with no servers, which would never connect', () => {
    const configuration = peerConfiguration([])
    expect(configuration.iceTransportPolicy).toBeUndefined()
    expect(configuration.bundlePolicy).toBe('max-bundle')
  })
})

describe('toSessionDescription', () => {
  it('normalises a valid answer', () => {
    expect(toSessionDescription({ type: 'answer', sdp: 'v=0...' })).toEqual({
      type: 'answer',
      sdp: 'v=0...',
    })
  })

  it('rejects the shapes that mean "no answer yet"', () => {
    expect(toSessionDescription({ type: 'unspecified', sdp: 'x' })).toBeNull()
    expect(toSessionDescription({ type: 'answer' })).toBeNull()
    expect(toSessionDescription(null)).toBeNull()
    expect(toSessionDescription('answer')).toBeNull()
  })
})
