import type { Group, Texture } from 'three'
import { SRGBColorSpace, Sprite, SpriteMaterial, TextureLoader } from 'three'

import { SKETCH_LAYER } from '@src/clientSideScene/sceneUtils'

export const SKETCH_SOLVE_ORIGIN_SPRITE = 'sketch-solve-origin-sprite'

const ORIGIN_SPRITE_SIZE_PX = 10
const ORIGIN_SPRITE_RENDER_ORDER = 12

const originTextureLoader = new TextureLoader()
let originTexture: Texture | null = null

export function updateOriginSprite(
  sketchSolveGroup: Group,
  scaleFactor: number
) {
  const sprite = getOriginSprite(sketchSolveGroup)
  sprite.scale.setScalar(ORIGIN_SPRITE_SIZE_PX * scaleFactor)
}

function getOriginSprite(sketchSolveGroup: Group): Sprite {
  const existingObject = sketchSolveGroup.getObjectByName(
    SKETCH_SOLVE_ORIGIN_SPRITE
  )
  if (existingObject instanceof Sprite) {
    return existingObject
  }

  if (existingObject) {
    sketchSolveGroup.remove(existingObject)
  }

  const sprite = new Sprite(
    new SpriteMaterial({
      map: getOriginTexture(),
      transparent: true,
      depthTest: false,
      depthWrite: false,
      color: 0xffffff,
    })
  )
  sprite.name = SKETCH_SOLVE_ORIGIN_SPRITE
  sprite.renderOrder = ORIGIN_SPRITE_RENDER_ORDER
  sprite.layers.set(SKETCH_LAYER)
  sketchSolveGroup.add(sprite)
  return sprite
}

function getOriginTexture(): Texture {
  if (originTexture) {
    return originTexture
  }

  originTexture = originTextureLoader.load(
    createSketchSolveOriginSpriteSvgDataUrl()
  )
  originTexture.colorSpace = SRGBColorSpace
  return originTexture
}

export function createSketchSolveOriginSpriteSvgDataUrl() {
  const dpr = window.devicePixelRatio || 1
  const rasterSize = ORIGIN_SPRITE_SIZE_PX * dpr
  const svg = `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="${rasterSize}"
      height="${rasterSize}"
      viewBox="0 0 10 10"
      fill="none"
    >
      <circle cx="5" cy="5" r="3" fill="#D9D9D9" />
      <circle cx="5" cy="5" r="4.5" stroke="#D9D9D9" />
    </svg>
  `.trim()

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
