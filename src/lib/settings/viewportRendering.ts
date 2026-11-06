import type { PostEffectType } from '@kittycad/lib'
import { getThemeColorForEngine, Themes } from '@src/lib/theme'

export type ViewportRendering = PostEffectType

export const viewportRenderingOptions: {
  name: string
  value: ViewportRendering
}[] = [
  { name: 'Default (Shaded + ambient occlusion)', value: 'ssao' },
  { name: 'Shaded', value: 'noeffect' },
  { name: 'Retro CAD', value: 'retrocad' },
  { name: 'Phosphor / CRT', value: 'phosphor' },
]

export function isViewportRendering(
  value: unknown
): value is ViewportRendering {
  return viewportRenderingOptions.some((option) => option.value === value)
}

export function viewportRenderingFromLegacySSAO(
  enabled: boolean | null | undefined
): ViewportRendering | undefined {
  return enabled == null ? undefined : enabled ? 'ssao' : 'noeffect'
}

export function viewportRenderingHasSSAO(
  mode: ViewportRendering | undefined
): boolean | undefined {
  return mode === undefined ? undefined : mode === 'ssao'
}

export function getViewportTheme(
  theme: Themes,
  mode: ViewportRendering
): Themes {
  return mode === 'retrocad' || mode === 'phosphor' ? Themes.Dark : theme
}

export function getViewportBackgroundColor(
  theme: Themes,
  mode: ViewportRendering
) {
  return mode === 'retrocad' || mode === 'phosphor'
    ? { r: 0, g: 0, b: 0, a: 1 }
    : getThemeColorForEngine(theme)
}
