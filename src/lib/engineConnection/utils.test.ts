import {
  getDimensions,
  getModelingData,
  getResponseErrorMessage,
  MAX_STREAM_DIMENSION,
  MIN_STREAM_DIMENSION,
  STREAM_DIMENSION_FACTOR,
} from '@src/lib/engineConnection/utils'
import { describe, expect, it } from 'vitest'

function modelingResponse(type: string, data: unknown) {
  return {
    resp: { type: 'modeling', data: { modeling_response: { type, data } } },
  }
}

function expectSupportedStreamDimensions({
  width,
  height,
}: {
  width: number
  height: number
}) {
  expect(width).toBeGreaterThanOrEqual(MIN_STREAM_DIMENSION)
  expect(height).toBeGreaterThanOrEqual(MIN_STREAM_DIMENSION)
  expect(width).toBeLessThanOrEqual(MAX_STREAM_DIMENSION)
  expect(height).toBeLessThanOrEqual(MAX_STREAM_DIMENSION)
  expect(width % STREAM_DIMENSION_FACTOR).toBe(0)
  expect(height % STREAM_DIMENSION_FACTOR).toBe(0)
}

describe('getDimensions', () => {
  it.each([
    [240, { width: 852, height: 256 }],
    [164, { width: 1248, height: 256 }],
    [112, { width: 1828, height: 256 }],
    [232, { width: 884, height: 256 }],
    [100, { width: 2048, height: 256 }],
  ])('scales observed undersized height %ipx', (height, expected) => {
    const dimensions = getDimensions(800, height)

    expect(dimensions).toEqual(expected)
    expectSupportedStreamDimensions(dimensions)
  })

  it('scales an undersized width with an otherwise valid height', () => {
    const dimensions = getDimensions(240, 800)

    expect(dimensions).toEqual({ width: 256, height: 852 })
    expectSupportedStreamDimensions(dimensions)
  })

  it('keeps a normal viewport unchanged', () => {
    const dimensions = getDimensions(1280, 720)

    expect(dimensions).toEqual({ width: 1280, height: 720 })
    expectSupportedStreamDimensions(dimensions)
  })

  it('preserves maximum-resolution downscaling', () => {
    const dimensions = getDimensions(4000, 3000)

    expect(dimensions).toEqual({ width: 2160, height: 1620 })
    expectSupportedStreamDimensions(dimensions)
  })

  it('keeps extreme aspect ratios inside the supported range', () => {
    const dimensions = getDimensions(5000, 100)

    expect(dimensions).toEqual({ width: 2160, height: 256 })
    expectSupportedStreamDimensions(dimensions)
  })

  it('leaves zero dimensions invalid for the connection guard', () => {
    expect(getDimensions(0, 800)).toEqual({ width: 0, height: 800 })
  })
})

describe('engine response helpers', () => {
  it('extracts error messages from rejected and failed commands', () => {
    expect(getResponseErrorMessage(new Error('Rejected'), 'Fallback')).toBe(
      'Rejected'
    )
    expect(
      getResponseErrorMessage(
        [{ errors: [{ message: 'Engine failed' }] }],
        'Fallback'
      )
    ).toBe('Engine failed')
    expect(getResponseErrorMessage(null, 'Fallback')).toBe('Fallback')
  })

  it('extracts data only from the expected modeling response', () => {
    expect(
      getModelingData(modelingResponse('volume', 42), 'volume', 'Failed')
    ).toEqual({ type: 'data', data: 42 })

    expect(
      getModelingData(modelingResponse('mass', 42), 'volume', 'Failed')
    ).toEqual({ type: 'error', error: new Error('Failed') })
  })
})
