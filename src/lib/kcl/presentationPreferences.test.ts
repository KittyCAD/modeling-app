import { createScenePresentationPreferences } from '@src/lib/kcl/presentationPreferences'
import { createSceneExecutionSettings } from '@src/lib/scene/settings'
import { createSettings } from '@src/lib/settings/initialSettings'
import { expect, it, vi } from 'vitest'

it('routes renderer, camera, and unit changes to their own consumers', () => {
  const settings = createSettings()
  const preferences = createScenePresentationPreferences(() => settings)
  const camera = vi.fn(),
    appearance = vi.fn(),
    renderer = vi.fn(),
    units = vi.fn()
  const stops = [
    preferences.camera.subscribe(camera),
    preferences.appearance.subscribe(appearance),
    preferences.localRenderer.subscribe(renderer),
    preferences.defaultUnit.subscribe(units),
  ]
  try {
    vi.clearAllMocks()
    settings.modeling.highlightEdges.user =
      !settings.modeling.highlightEdges.current
    expect(renderer).toHaveBeenCalledOnce()
    expect(camera).not.toHaveBeenCalled()
    expect(appearance).not.toHaveBeenCalled()
    settings.modeling.cameraProjection.user =
      settings.modeling.cameraProjection.current === 'orthographic'
        ? 'perspective'
        : 'orthographic'
    expect(camera).toHaveBeenCalledOnce()
    expect(appearance).not.toHaveBeenCalled()
    expect(renderer).toHaveBeenCalledOnce()
    settings.modeling.defaultUnit.user =
      settings.modeling.defaultUnit.current === 'in' ? 'mm' : 'in'
    expect(units).toHaveBeenCalledOnce()
    expect(camera).toHaveBeenCalledOnce()
    expect(renderer).toHaveBeenCalledOnce()
  } finally {
    stops.forEach((stop) => stop())
    preferences.dispose()
  }
})
it('lets native-only grid visibility refresh execution without updating presentation consumers', () => {
  const settings = createSettings()
  const preferences = createScenePresentationPreferences(() => settings)
  const native = createSceneExecutionSettings(() => settings)
  const before = native.executeRevision.value
  const changed = vi.fn()
  const stops = [
    preferences.camera.subscribe(changed),
    preferences.appearance.subscribe(changed),
    preferences.localRenderer.subscribe(changed),
  ]
  try {
    changed.mockClear()
    settings.modeling.showScaleGrid.user =
      !settings.modeling.showScaleGrid.current
    expect(native.executeRevision.value).not.toBe(before)
    expect(changed).not.toHaveBeenCalled()
  } finally {
    stops.forEach((stop) => stop())
    preferences.dispose()
  }
})
