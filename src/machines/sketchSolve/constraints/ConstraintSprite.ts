import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { CONSTRAINT_TYPE } from '@src/machines/sketchSolve/constraints/constraintUtils'
import {
  CanvasTexture,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
  type ColorRepresentation,
  type Vector3,
} from 'three'

const ICON_VIEWBOX_SIZE = 20
const ICON_TEXTURE_SIZE = 64

export const CONSTRAINT_SPRITE = 'CONSTRAINT_SPRITE'
export const CONSTRAINT_SPRITE_HIT_AREA = 'CONSTRAINT_SPRITE_HIT_AREA'
export const CONSTRAINT_SPRITE_SIZE_PX = 20
export const CONSTRAINT_SPRITE_HIT_AREA_SIZE_PX = 28
export const CONSTRAINT_SPRITE_RENDER_ORDER = 100

const iconTextureCache = new Map<string, CanvasTexture>()
const hitAreaGeometry = new PlaneGeometry(1, 1)
const hitAreaMaterial = new MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0,
  side: DoubleSide,
  depthTest: false,
  depthWrite: false,
})

type CreateConstraintSpriteArgs = {
  constraintId: number
  constraintType: string
  iconPath: string
  color?: ColorRepresentation
  renderOrder?: number
}

type UpdateConstraintSpriteArgs = {
  sceneInfra: SceneInfra
  position: Vector3
  offsetPx?: {
    x: number
    y: number
  }
  color?: ColorRepresentation
  sizePx?: number
  hitAreaSizePx?: number
  renderOrder?: number
  visible?: boolean
}

export function createConstraintSprite({
  constraintId,
  constraintType,
  iconPath,
  color = 0xffffff,
  renderOrder = CONSTRAINT_SPRITE_RENDER_ORDER,
}: CreateConstraintSpriteArgs): Group {
  const group = new Group()
  group.name = constraintId.toString()
  group.userData = {
    type: CONSTRAINT_TYPE,
    constraintType,
    object_id: constraintId,
  }

  const sprite = new Sprite(
    new SpriteMaterial({
      map: getIconTexture(iconPath),
      color,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
  )
  sprite.userData.type = CONSTRAINT_SPRITE
  sprite.renderOrder = renderOrder
  group.add(sprite)

  const hitArea = new Mesh(hitAreaGeometry, hitAreaMaterial)
  hitArea.userData.type = CONSTRAINT_SPRITE_HIT_AREA
  hitArea.renderOrder = renderOrder
  group.add(hitArea)

  return group
}

export function updateConstraintSprite(
  group: Group,
  {
    sceneInfra,
    position,
    offsetPx,
    color = 0xffffff,
    sizePx = CONSTRAINT_SPRITE_SIZE_PX,
    hitAreaSizePx = CONSTRAINT_SPRITE_HIT_AREA_SIZE_PX,
    renderOrder = CONSTRAINT_SPRITE_RENDER_ORDER,
    visible = true,
  }: UpdateConstraintSpriteArgs
) {
  group.visible = visible
  if (!visible) return

  const scale = sceneInfra.getClientSceneScaleFactor(group)
  group.position.copy(position)
  if (offsetPx) {
    group.position.x += offsetPx.x * scale
    group.position.y += offsetPx.y * scale
  }
  const sprite = group.children.find(
    (child) => child.userData.type === CONSTRAINT_SPRITE
  ) as Sprite | undefined
  const hitArea = group.children.find(
    (child) => child.userData.type === CONSTRAINT_SPRITE_HIT_AREA
  ) as Mesh | undefined

  if (sprite) {
    sprite.material.color.set(color)
    sprite.material.needsUpdate = true
    sprite.renderOrder = renderOrder
    sprite.scale.set(sizePx * scale, sizePx * scale, 1)
  }

  if (hitArea) {
    hitArea.renderOrder = renderOrder
    hitArea.scale.set(hitAreaSizePx * scale, hitAreaSizePx * scale, 1)
  }
}

function getIconTexture(iconPath: string): CanvasTexture {
  const cachedTexture = iconTextureCache.get(iconPath)
  if (cachedTexture) {
    return cachedTexture
  }

  const textureSize =
    ICON_TEXTURE_SIZE *
    (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1)
  const canvas = createTextureCanvas()
  canvas.width = textureSize
  canvas.height = textureSize

  const ctx = canvas.getContext('2d')
  if (ctx && typeof Path2D !== 'undefined') {
    ctx.fillStyle = '#ffffff'
    ctx.scale(textureSize / ICON_VIEWBOX_SIZE, textureSize / ICON_VIEWBOX_SIZE)
    ctx.fill(new Path2D(iconPath))
  }

  const texture = new CanvasTexture(canvas as HTMLCanvasElement)
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true

  iconTextureCache.set(iconPath, texture)
  return texture
}

function createTextureCanvas(): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document !== 'undefined') {
    return document.createElement('canvas')
  }

  return new OffscreenCanvas(1, 1)
}
