import type { Group, Texture } from 'three'
import { SRGBColorSpace, Sprite, SpriteMaterial, TextureLoader } from 'three'

import { SKETCH_LAYER } from '@src/clientSideScene/sceneUtils'
import { getResolvedTheme, Themes } from '@src/lib/theme'
import { RENDER_ORDER } from '@src/machines/sketchSolve/renderOrder'

export const SKETCH_SOLVE_ORIGIN_SPRITE = 'sketch-solve-origin-sprite'

const ORIGIN_SPRITE_SIZE_PX = 10

const originTextureLoader = new TextureLoader()
const originTextureCache = new Map<Themes, Texture>()

export function updateOriginSprite(
  sketchSolveGroup: Group,
  scaleFactor: number,
  theme: Themes
) {
  const sprite = getOriginSprite(sketchSolveGroup, getResolvedTheme(theme))
  sprite.position.set(0, 0, 0)
  sprite.scale.setScalar(ORIGIN_SPRITE_SIZE_PX * scaleFactor)
}

function getOriginSprite(sketchSolveGroup: Group, theme: Themes): Sprite {
  const existingObject = sketchSolveGroup.getObjectByName(
    SKETCH_SOLVE_ORIGIN_SPRITE
  )
  if (existingObject instanceof Sprite) {
    if (existingObject.material.map !== getOriginTexture(theme)) {
      existingObject.material.map = getOriginTexture(theme)
      existingObject.material.needsUpdate = true
    }
    return existingObject
  }

  if (existingObject) {
    sketchSolveGroup.remove(existingObject)
  }

  const sprite = new Sprite(
    new SpriteMaterial({
      map: getOriginTexture(theme),
      // has to be transparent false, with an explicit background to match the background,
      // otherwise it would cover non-transparent segments.
      transparent: false,
      depthTest: false,
      depthWrite: false,
      color: 0xffffff,
    })
  )
  sprite.name = SKETCH_SOLVE_ORIGIN_SPRITE
  sprite.renderOrder = RENDER_ORDER.ORIGIN_SPRITE
  sprite.layers.set(SKETCH_LAYER)
  sketchSolveGroup.add(sprite)
  return sprite
}

function getOriginTexture(theme: Themes): Texture {
  const cachedTexture = originTextureCache.get(theme)
  if (cachedTexture) {
    return cachedTexture
  }

  const texture = originTextureLoader.load(
    createSketchSolveOriginSpriteSvgDataUrl(theme)
  )
  texture.colorSpace = SRGBColorSpace
  originTextureCache.set(theme, texture)
  return texture
}

export function createSketchSolveOriginSpriteSvgDataUrl(theme: Themes) {
  const dpr = window.devicePixelRatio || 1
  const rasterSize = ORIGIN_SPRITE_SIZE_PX * dpr
  // Need to make the Sprite opaque (transparent: false) so it can be rendered below the opaque segment meshes.
  // (Because transparent objects are rendered after opaque ones).
  // So need to use backgroundFill based on the theme.
  // Other options would be:
  // - both transparent: make segment meshes transparent, which is slightly slower to render, but probably doesn't matter)
  // - both opaque: render this svg via triangle geometry so it can be opaque. 
  // - segments opaque, origin transparent: need to enable depthTest, depthWrite, z offsets.
  const backgroundFill = theme === Themes.Dark ? '#FAFAFA' : '#1E1E1E'
  const svg = `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="${rasterSize}"
      height="${rasterSize}"
      viewBox="0 0 10 10"
      fill="none"
    >
      <rect width="10" height="10" fill="${backgroundFill}" />
      <circle cx="5" cy="5" r="3" fill="#D9D9D9" />
      <circle cx="5" cy="5" r="4.5" stroke="#D9D9D9" />
    </svg>
  `.trim()

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
