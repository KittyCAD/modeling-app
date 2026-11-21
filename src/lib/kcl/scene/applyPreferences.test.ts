import type { CameraControls } from '@src/clientSideScene/CameraControls'
import { cameraMouseDragGuards } from '@src/lib/cameraControls'
import {
  createCameraInputApplier,
  applySceneOverlayTheme,
} from '@src/lib/kcl/scene/applyPreferences'
import { Themes } from '@src/lib/theme'
import { expect, it, vi } from 'vitest'

it('changes mouse and touch controls independently without reinstalling unchanged touch handlers', () => {
  const controls = {
    interactionGuards: cameraMouseDragGuards.Zoo,
    initTouchControls: vi.fn(),
  } satisfies Pick<CameraControls, 'interactionGuards' | 'initTouchControls'>
  const apply = createCameraInputApplier(controls)
  apply({ mouseControls: 'Zoo', enableTouchControls: true })
  expect(
    controls.interactionGuards.rotate.callback(
      new MouseEvent('mousedown', { button: 2 })
    )
  ).toBe(true)
  expect(controls.initTouchControls).toHaveBeenCalledExactlyOnceWith(true)
  apply({ mouseControls: 'Trackpad Friendly', enableTouchControls: true })
  expect(
    controls.interactionGuards.rotate.callback(
      new MouseEvent('mousedown', { button: 2 })
    )
  ).toBe(false)
  expect(controls.initTouchControls).toHaveBeenCalledOnce()
  apply({ mouseControls: 'Trackpad Friendly', enableTouchControls: false })
  expect(controls.initTouchControls.mock.calls).toEqual([[true], [false]])
  apply({ mouseControls: 'Trackpad Friendly', enableTouchControls: false })
  expect(controls.initTouchControls).toHaveBeenCalledTimes(2)
})

it('keeps camera input application independent between views', () => {
  const first = {
    interactionGuards: cameraMouseDragGuards.Zoo,
    initTouchControls: vi.fn(),
  }
  const second = {
    interactionGuards: cameraMouseDragGuards.Zoo,
    initTouchControls: vi.fn(),
  }
  const applyFirst = createCameraInputApplier(first)
  const applySecond = createCameraInputApplier(second)
  applyFirst({ mouseControls: 'Zoo', enableTouchControls: false })
  applySecond({ mouseControls: 'Zoo', enableTouchControls: false })
  expect(second.initTouchControls).toHaveBeenCalledExactlyOnceWith(false)
  applyFirst({ mouseControls: 'Trackpad Friendly', enableTouchControls: true })
  expect(second.initTouchControls).toHaveBeenCalledOnce()
  expect(
    second.interactionGuards.rotate.callback(
      new MouseEvent('mousedown', { button: 2 })
    )
  ).toBe(true)
})

it.each([
  [Themes.Light, 'noeffect', false, Themes.Dark],
  [Themes.Dark, 'noeffect', false, Themes.Light],
  [Themes.Light, 'retrocad', false, Themes.Light],
  [Themes.Light, 'phosphor', false, Themes.Light],
  [Themes.Light, 'retrocad', true, Themes.Dark],
] as const)(
  'uses %s/%s/local=%s to give sketch graphics the %s foreground',
  (theme, mode, local, expected) => {
    const scene = { theme: Themes.System }
    expect(applySceneOverlayTheme(scene, theme, mode, local)).toBe(expected)
    expect(scene.theme).toBe(expected)
  }
)
