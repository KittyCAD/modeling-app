import { describe, expect, it } from 'vitest'
import {
  type CameraSystem,
  cameraMouseGuards,
  cameraSystems,
  interactionFor,
} from '@src/features/engineScene/camera/mouseGuards'

const guards = cameraMouseGuards('MacIntel')

/** A pointer event as the browser reports it mid-drag: `buttons`, not `button`. */
const drag = (
  buttons: number,
  modifiers: Partial<
    Record<'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey', boolean>
  > = {}
) =>
  ({
    buttons,
    button: -1,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...modifiers,
  }) as MouseEvent

/** A wheel event. jsdom leaves `buttons` unset, so it is supplied here. */
const scroll = (buttons = 0) =>
  ({ deltaY: 10, buttons }) as unknown as WheelEvent

const LEFT = 1
const RIGHT = 2
const MIDDLE = 4

const of = (system: CameraSystem, event: MouseEvent) =>
  interactionFor(guards[system], event, 'spherical')

describe('camera mouse guards', () => {
  it('covers every system', () => {
    for (const system of cameraSystems) {
      expect(guards[system].label).toBeTruthy()
      expect(guards[system].pan.description).toBeTruthy()
    }
  })

  it('reads Zoo’s gestures', () => {
    expect(of('zoo', drag(RIGHT))).toBe('rotate')
    expect(of('zoo', drag(RIGHT, { shiftKey: true }))).toBe('pan')
    expect(of('zoo', drag(MIDDLE))).toBe('pan')
    expect(of('zoo', drag(RIGHT, { ctrlKey: true }))).toBe('zoom')
    expect(of('zoo', drag(LEFT))).toBeNull()
  })

  it('lets a modified gesture win over the bare one', () => {
    // Zoo's rotate is a plain right drag and its pan is Shift plus a right drag,
    // so the order the guards are asked in is what makes Shift mean anything.
    expect(of('zoo', drag(RIGHT, { shiftKey: true }))).toBe('pan')
  })

  it('reads OnShape’s gestures', () => {
    expect(of('onshape', drag(RIGHT))).toBe('rotate')
    expect(of('onshape', drag(RIGHT, { ctrlKey: true }))).toBe('pan')
    expect(of('onshape', drag(MIDDLE))).toBe('pan')
  })

  it('reads the trackpad-friendly gestures', () => {
    expect(of('trackpad_friendly', drag(LEFT, { altKey: true }))).toBe('rotate')
    expect(
      of('trackpad_friendly', drag(LEFT, { altKey: true, shiftKey: true }))
    ).toBe('pan')
    expect(
      of('trackpad_friendly', drag(LEFT, { altKey: true, metaKey: true }))
    ).toBe('zoom')
    expect(of('trackpad_friendly', drag(LEFT))).toBeNull()
  })

  it('reads Solidworks, NX and AutoCAD middle-button gestures', () => {
    expect(of('solidworks', drag(MIDDLE))).toBe('rotate')
    expect(of('solidworks', drag(RIGHT, { ctrlKey: true }))).toBe('pan')
    expect(of('nx', drag(MIDDLE))).toBe('rotate')
    expect(of('nx', drag(MIDDLE, { shiftKey: true }))).toBe('pan')
    expect(of('autocad', drag(MIDDLE))).toBe('pan')
    expect(of('autocad', drag(MIDDLE, { shiftKey: true }))).toBe('rotate')
  })

  it('reads Creo’s chorded rotate', () => {
    // Left and right together, which is why the guards take the whole event
    // rather than a button and a modifier list.
    expect(of('creo', drag(LEFT | RIGHT, { ctrlKey: true }))).toBe('rotate')
    expect(of('creo', drag(MIDDLE, { ctrlKey: true }))).toBe('rotate')
    expect(of('creo', drag(LEFT, { ctrlKey: true }))).toBe('pan')
    expect(of('creo', drag(RIGHT, { ctrlKey: true }))).toBe('zoom')
  })

  it('names modifiers the way the platform does', () => {
    expect(
      cameraMouseGuards('MacIntel').trackpad_friendly.rotate.description
    ).toContain('Option')
    expect(
      cameraMouseGuards('Win32').trackpad_friendly.rotate.description
    ).toContain('Alt')
  })

  it('turns rotate into a trackball orbit when asked', () => {
    expect(interactionFor(guards.zoo, drag(RIGHT), 'trackball')).toBe(
      'rotatetrackball'
    )
    // Only rotate changes; the others have no trackball variant.
    expect(interactionFor(guards.zoo, drag(MIDDLE), 'trackball')).toBe('pan')
  })

  it('zooms on a scroll with no button held', () => {
    expect(interactionFor(guards.zoo, scroll(), 'spherical')).toBe('zoom')
    // A real event too, so the shape check is not only satisfied by the fake.
    expect(
      interactionFor(
        guards.zoo,
        new WheelEvent('wheel', { deltaY: 10 }),
        'spherical'
      )
    ).toBe('zoom')
  })

  it('ignores a scroll during a drag', () => {
    // Otherwise a two-finger scroll partway through an orbit fights the drag.
    expect(interactionFor(guards.zoo, scroll(RIGHT), 'spherical')).toBeNull()
  })

  it('does not offer a drag zoom where the package has none', () => {
    expect(
      of('onshape', drag(LEFT, { ctrlKey: true, shiftKey: true }))
    ).toBeNull()
    expect(of('autocad', drag(LEFT, { ctrlKey: true }))).toBeNull()
  })
})
