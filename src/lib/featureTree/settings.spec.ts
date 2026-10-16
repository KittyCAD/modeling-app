import { join } from 'node:path'
import { expect, it } from 'vitest'
import { parseAppSettings, serializeConfiguration } from '@src/lang/wasm'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import {
  featureTreeSettings,
  type FeatureTreeDisplay,
  getFeatureTreeAppearance,
} from '@src/lib/featureTree/settings'
import { createSettings } from '@src/lib/settings/initialSettings'
import type { Setting } from '@src/lib/settings/Setting'
import {
  configurationToSettingsPayload,
  getChangedSettingsAtLevel,
  setSettingsAtLevel,
  settingsPayloadToConfiguration,
} from '@src/lib/settings/settingsUtils'

it('keeps an explicit non-HUD preference through the settings file round-trip', async () => {
  const wasm = await loadAndInitialiseWasmInstance(
    join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
  )
  const settings = createSettings(featureTreeSettings)
  const display = (
    settings.modeling as unknown as Record<string, Setting<FeatureTreeDisplay>>
  ).featureTreeDisplay
  display.user = 'standard'
  const serialized = serializeConfiguration(
    settingsPayloadToConfiguration(
      getChangedSettingsAtLevel(settings, 'user'),
      featureTreeSettings
    ),
    wasm
  )
  if (serialized instanceof Error) throw serialized
  expect(serialized).toContain('feature_tree_display = "standard"')
  const parsed = parseAppSettings(serialized, wasm)
  if (parsed instanceof Error) throw parsed
  const restored = createSettings(featureTreeSettings)
  setSettingsAtLevel(
    restored,
    'user',
    configurationToSettingsPayload(parsed, featureTreeSettings)
  )
  expect(getFeatureTreeAppearance(restored)).toBe('default')
})
