import type { Texture } from 'three'
import { SRGBColorSpace, Sprite, SpriteMaterial, TextureLoader } from 'three'

import { constraintIconPaths } from '@src/components/constraintIconPaths'
import { SKETCH_SELECTION_RGB } from '@src/lib/constants'
import { Themes } from '@src/lib/theme'

export type ConstraintBadgeType =
  | 'Coincident'
  | 'Horizontal'
  | 'Vertical'
  | 'LinesEqualLength'
  | 'Parallel'
  | 'Perpendicular'
  | 'Tangent'

export type ConstraintBadgeState = 'default' | 'hovered' | 'selected'

export const CONSTRAINT_BADGE_SIZE_PX = 20

const textureLoader = new TextureLoader()
const textureCache = new Map<string, Texture>()

export function createConstraintBadgeSprite() {
  return new Sprite(
    new SpriteMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      color: 0xffffff,
    })
  )
}

export function getConstraintBadgeTexture({
  badgeType,
  badgeState,
  theme,
  sizePx = CONSTRAINT_BADGE_SIZE_PX,
}: {
  badgeType: ConstraintBadgeType
  badgeState: ConstraintBadgeState
  theme: Themes
  sizePx?: number
}) {
  const key = `${badgeType}:${badgeState}:${theme}:${sizePx}`
  const cached = textureCache.get(key)
  if (cached) {
    return cached
  }

  const texture = textureLoader.load(
    createConstraintBadgeSvgDataUrl({
      badgeType,
      badgeState,
      theme,
      sizePx,
    })
  )
  texture.colorSpace = SRGBColorSpace
  textureCache.set(key, texture)
  return texture
}

function createConstraintBadgeSvgDataUrl({
  badgeType,
  badgeState,
  theme,
  sizePx,
}: {
  badgeType: ConstraintBadgeType
  badgeState: ConstraintBadgeState
  theme: Themes
  sizePx: number
}) {
  const dpr = window.devicePixelRatio || 1
  const rasterSize = sizePx * dpr
  const hasBorder = badgeState !== 'default'
  const borderStroke = hasBorder
    ? `rgba(${SKETCH_SELECTION_RGB.join(', ')}, ${
        badgeState === 'hovered' ? 0.8 : 1
      })`
    : 'none'
  const borderWidth = hasBorder ? 1 : 0
  const rectInset = hasBorder ? 0.5 : 0
  const badgeFill = theme === Themes.Dark ? '#FAFAFA' : '#1E1E1E'
  const iconFill = theme === Themes.Dark ? '#000000' : '#FFFFFF'
  const svg = `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="${rasterSize}"
      height="${rasterSize}"
      viewBox="0 0 ${sizePx} ${sizePx}"
      fill="none"
    >
      <rect
        x="${rectInset}"
        y="${rectInset}"
        width="${sizePx - rectInset * 2}"
        height="${sizePx - rectInset * 2}"
        rx="2"
        fill="${badgeFill}"
        stroke="${borderStroke}"
        stroke-width="${borderWidth}"
      />
      <path d="${getConstraintBadgeIconPath(badgeType)}" fill="${iconFill}" />
    </svg>
  `.trim()

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function getConstraintBadgeIconPath(badgeType: ConstraintBadgeType) {
  switch (badgeType) {
    case 'Coincident':
      return constraintIconPaths.coincident
    case 'Horizontal':
      return constraintIconPaths.horizontal
    case 'Vertical':
      return constraintIconPaths.vertical
    case 'LinesEqualLength':
      return constraintIconPaths.equal
    case 'Parallel':
      return constraintIconPaths.parallel
    case 'Perpendicular':
      return constraintIconPaths.perpendicular
    case 'Tangent':
      return constraintIconPaths.tangent
  }
}
