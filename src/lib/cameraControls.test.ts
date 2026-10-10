import { cameraMouseDragGuards, cameraSystems } from '@src/lib/cameraControls'
import { describe, expect, it } from 'vitest'

describe('Ctrl selection and camera presets', () => {
  it.each(cameraSystems)('keeps Ctrl+left-drag routing for %s', (system) => {
    const event = new MouseEvent('mousedown', {
      button: 0,
      buttons: 1,
      ctrlKey: true,
    })
    const guards = cameraMouseDragGuards[system]
    expect(guards.pan.callback(event)).toBe(system === 'Creo')
    expect(guards.rotate.callback(event)).toBe(false)
    expect(guards.zoom.dragCallback(event)).toBe(false)
  })

  it.each(cameraSystems)('keeps Ctrl+right-drag routing for %s', (system) => {
    const event = new MouseEvent('mousedown', {
      button: 2,
      buttons: 2,
      ctrlKey: true,
    })
    const guards = cameraMouseDragGuards[system]
    expect(guards.pan.callback(event)).toBe(
      system === 'OnShape' || system === 'Solidworks'
    )
    expect(guards.rotate.callback(event)).toBe(false)
    expect(guards.zoom.dragCallback(event)).toBe(
      system === 'Zoo' || system === 'Creo'
    )
  })

  it.each(cameraSystems)('keeps Ctrl+middle-drag routing for %s', (system) => {
    const event = new MouseEvent('mousedown', {
      button: 1,
      buttons: 4,
      ctrlKey: true,
    })
    const guards = cameraMouseDragGuards[system]
    expect(guards.pan.callback(event)).toBe(false)
    expect(guards.rotate.callback(event)).toBe(system === 'Creo')
    expect(guards.zoom.dragCallback(event)).toBe(system === 'NX')
  })
})
