import { describe, expect, it } from 'vitest'

import {
  cameraMouseDragGuards,
  cameraSystemToMouseControl,
  mouseControlsToCameraSystem,
} from '@src/lib/cameraControls'
import {
  getInteractionType,
  isPinchToZoom,
} from '@src/clientSideScene/CameraControls'

/**
 * happy-dom's WheelEvent doesn't propagate MouseEvent properties (ctrlKey,
 * shiftKey, buttons, etc.) from the constructor init object.  Work around
 * this by assigning them after construction.
 */
function wheel(init?: WheelEventInit): WheelEvent {
  const e = new WheelEvent('wheel', { deltaMode: 0, ...init })
  // Patch modifier keys and buttons that happy-dom drops
  Object.defineProperty(e, 'ctrlKey', { value: init?.ctrlKey ?? false })
  Object.defineProperty(e, 'shiftKey', { value: init?.shiftKey ?? false })
  Object.defineProperty(e, 'altKey', { value: init?.altKey ?? false })
  Object.defineProperty(e, 'metaKey', { value: init?.metaKey ?? false })
  Object.defineProperty(e, 'buttons', { value: init?.buttons ?? 0 })
  return e
}

describe('cameraControls', () => {
  it('maps Apple Trackpad camera system to/from mouse control type', () => {
    expect(mouseControlsToCameraSystem('apple_trackpad' as any)).toBe(
      'Apple Trackpad'
    )
    expect(cameraSystemToMouseControl('Apple Trackpad')).toBe('apple_trackpad')
  })

  it('uses expected Apple Trackpad wheel guards', () => {
    const guards = cameraMouseDragGuards['Apple Trackpad']

    expect(guards.pan.scrollCallback?.(wheel({ altKey: true }))).toBe(true)
    expect(guards.zoom.scrollCallback(wheel({ shiftKey: true }))).toBe(true)
    expect(guards.rotate.scrollCallback?.(wheel())).toBe(true)
    expect(guards.zoom.pinchToZoom).toBe(true)
  })
})

describe('isPinchToZoom', () => {
  it('returns true when ctrlKey is set (browser pinch-to-zoom signal)', () => {
    expect(isPinchToZoom(wheel({ ctrlKey: true }))).toBe(true)
  })

  it('returns false for plain wheel events', () => {
    expect(isPinchToZoom(wheel())).toBe(false)
  })

  it('returns false for shift+wheel', () => {
    expect(isPinchToZoom(wheel({ shiftKey: true }))).toBe(false)
  })
})

describe('getInteractionType with Apple Trackpad guards', () => {
  const guards = cameraMouseDragGuards['Apple Trackpad']
  const allEnabled = { enablePan: true, enableRotate: true, enableZoom: true }

  function resolve(event: WheelEvent, overrides?: Partial<typeof allEnabled>) {
    const { enablePan, enableRotate, enableZoom } = {
      ...allEnabled,
      ...overrides,
    }
    return getInteractionType(
      guards,
      event,
      enablePan,
      enableRotate,
      enableZoom
    )
  }

  it('bare scroll => rotate', () => {
    expect(resolve(wheel({ deltaX: 10, deltaY: 5 }))).toBe('rotate')
  })

  it('shift+scroll => zoom', () => {
    expect(resolve(wheel({ shiftKey: true, deltaY: 10 }))).toBe('zoom')
  })

  it('alt+scroll => pan', () => {
    expect(resolve(wheel({ altKey: true, deltaX: 10 }))).toBe('pan')
  })

  it('pinch-to-zoom (ctrlKey) => zoom, even though ctrlKey blocks rotate guard', () => {
    expect(resolve(wheel({ ctrlKey: true, deltaY: -5 }))).toBe('zoom')
  })

  it('pinch-to-zoom takes priority over other interactions', () => {
    // ctrlKey + altKey: pinch-to-zoom should win over pan
    expect(resolve(wheel({ ctrlKey: true, altKey: true }))).toBe('zoom')
  })

  it('returns none when rotate is disabled and bare scroll', () => {
    // Bare scroll matches rotate only; with rotate disabled, no other guard matches
    expect(resolve(wheel(), { enableRotate: false })).toBe('none')
  })

  it('returns none when zoom is disabled for shift+scroll', () => {
    expect(resolve(wheel({ shiftKey: true }), { enableZoom: false })).toBe(
      'none'
    )
  })

  it('returns none when pan is disabled for alt+scroll', () => {
    expect(resolve(wheel({ altKey: true }), { enablePan: false })).toBe('none')
  })

  it('returns none when zoom is disabled for pinch-to-zoom', () => {
    expect(resolve(wheel({ ctrlKey: true }), { enableZoom: false })).toBe(
      'none'
    )
  })
})

describe('getInteractionType preserves existing Zoo behavior', () => {
  const guards = cameraMouseDragGuards['Zoo']

  function resolve(event: WheelEvent) {
    return getInteractionType(guards, event, true, true, true)
  }

  it('bare scroll => zoom (Zoo has no scroll-to-pan/rotate)', () => {
    expect(resolve(wheel({ deltaY: 10 }))).toBe('zoom')
  })

  it('Zoo does not define pan.scrollCallback, so scroll never pans', () => {
    expect(guards.pan.scrollCallback).toBeUndefined()
  })

  it('Zoo does not define rotate.scrollCallback, so scroll never rotates', () => {
    expect(guards.rotate.scrollCallback).toBeUndefined()
  })
})
