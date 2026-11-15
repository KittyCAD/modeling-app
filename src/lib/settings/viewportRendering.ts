import type { PostEffectType } from '@kittycad/lib'
import {
  getOppositeTheme,
  getThemeColorForEngine,
  Themes,
} from '@src/lib/theme'

export type ViewportRendering =
  | 'default'
  | Exclude<PostEffectType, 'ssao' | 'noeffect'>

export const viewportRenderingOptions: {
  name: string
  value: ViewportRendering
}[] = [
  { name: 'Default', value: 'default' },
  { name: 'Retro CAD', value: 'retrocad' },
  { name: 'Phosphor', value: 'phosphor' },
]

export function isViewportRendering(
  value: unknown
): value is ViewportRendering {
  return viewportRenderingOptions.some((option) => option.value === value)
}

export function viewportRenderingFromStoredValue(
  value: unknown
): ViewportRendering | undefined {
  if (value === 'ssao' || value === 'noeffect') return 'default'
  return isViewportRendering(value) ? value : undefined
}

export function getViewportPostEffect(
  style: ViewportRendering,
  enableSSAO: boolean
): PostEffectType {
  return style === 'default' ? (enableSSAO ? 'ssao' : 'noeffect') : style
}

export function getViewportTheme(
  theme: Themes,
  mode: ViewportRendering | PostEffectType
): Themes {
  return mode === 'retrocad' || mode === 'phosphor' ? Themes.Dark : theme
}

/** `SceneInfra.theme` selects foreground colors for sketch segments, origins, and constraints. Legacy helpers expect the opposite of the viewport background theme. */
export function getSceneOverlayTheme(
  theme: Themes,
  mode: ViewportRendering | PostEffectType,
  geometryOnly: boolean
) {
  return getOppositeTheme(geometryOnly ? theme : getViewportTheme(theme, mode))
}

export function getViewportBackgroundColor(
  theme: Themes,
  mode: ViewportRendering | PostEffectType
) {
  return mode === 'retrocad' || mode === 'phosphor'
    ? { r: 0, g: 0, b: 0, a: 1 }
    : getThemeColorForEngine(theme)
}
