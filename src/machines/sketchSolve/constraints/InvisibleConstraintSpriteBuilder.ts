import {
  Group,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Texture,
  TextureLoader,
  Vector3,
} from 'three'

import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { constraintIconPaths } from '@src/components/constraintIconPaths'
import { SKETCH_SELECTION_COLOR } from '@src/lib/constants'
import { CONSTRAINT_TYPE } from '@src/machines/sketchSolve/constraints/constraintUtils'
import {
  getInvisibleConstraintAnchor,
  isInvisibleConstraintObject,
  type InvisibleConstraintObject,
} from '@src/machines/sketchSolve/constraints/invisibleConstraintSpriteUtils'

export class InvisibleConstraintSpriteBuilder {
  private readonly textureCache = new Map<string, Texture>()
  private readonly textureLoader = new TextureLoader()

  public init(obj: InvisibleConstraintObject) {
    const group = new Group()
    group.name = obj.id.toString()
    group.userData = {
      type: CONSTRAINT_TYPE,
      constraintType: obj.kind.constraint.type,
      object_id: obj.id,
    }
    group.visible = false

    const sprite = new Sprite(
      new SpriteMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
      })
    )
    sprite.userData.type = 'INVISIBLE_CONSTRAINT_SPRITE'
    sprite.renderOrder = 100
    group.add(sprite)

    return group
  }

  public update(
    group: Group,
    obj: ApiObject,
    objects: ApiObject[],
    sceneInfra: SceneInfra,
    _selectedIds: number[],
    _hoveredId: number | null,
    showNonVisualConstraints: boolean
  ) {
    if (!showNonVisualConstraints || !isInvisibleConstraintObject(obj)) {
      group.visible = false
      return
    }

    const anchor = getInvisibleConstraintAnchor(obj, objects)
    const sprite = group.children.find((child) => child instanceof Sprite) as
      | Sprite
      | undefined

    if (!anchor || !sprite) {
      group.visible = false
      return
    }

    group.position.copy(
      offsetWorldPosition(anchor, sceneInfra, {
        x: -15,
        y: -15,
      })
    )

    const scale = sceneInfra.getClientSceneScaleFactor(group)
    sprite.scale.setScalar(20 * scale)

    const texture = this.getTexture(obj.kind.constraint.type)

    const material = sprite.material as SpriteMaterial
    material.map = texture
    material.color.set(0xffffff)
    material.needsUpdate = true

    group.visible = true
  }

  private getTexture(
    objType: InvisibleConstraintObject['kind']['constraint']['type']
  ) {
    const key = objType
    const cached = this.textureCache.get(key)
    if (cached) {
      return cached
    }

    const texture = this.textureLoader.load(
      createConstraintBadgeSvgDataUrl(objType),
      (loadedTexture) => {
        loadedTexture.colorSpace = SRGBColorSpace
        loadedTexture.needsUpdate = true
      }
    )
    texture.colorSpace = SRGBColorSpace
    texture.needsUpdate = true
    this.textureCache.set(key, texture)
    return texture
  }
}

function offsetWorldPosition(
  worldPosition: Vector3,
  sceneInfra: SceneInfra,
  offsetPx: { x: number; y: number }
) {
  const projected = worldPosition.clone().project(sceneInfra.camControls.camera)
  const { clientWidth, clientHeight } = sceneInfra.renderer.domElement

  const screenX = (projected.x * 0.5 + 0.5) * clientWidth + offsetPx.x
  const screenY = (-projected.y * 0.5 + 0.5) * clientHeight + offsetPx.y

  return new Vector3(
    (screenX / clientWidth) * 2 - 1,
    -((screenY / clientHeight) * 2 - 1),
    projected.z
  ).unproject(sceneInfra.camControls.camera)
}

function createConstraintBadgeSvgDataUrl(
  objType: InvisibleConstraintObject['kind']['constraint']['type']
) {
  const iconPath = getInvisibleConstraintSpriteIcon(objType)
  const dpr = window.devicePixelRatio || 1
  const rasterSize = 20 * dpr
  const svg = `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="${rasterSize}"
      height="${rasterSize}"
      viewBox="0 0 20 20"
      fill="none"
    >
      <rect
        x="0.5"
        y="0.5"
        width="19"
        height="19"
        rx="2"
        fill="none"
        stroke="#${SKETCH_SELECTION_COLOR.toString(16).padStart(6, '0')}"
        stroke-width="1"
      />
      <path d="${iconPath}" fill="#FFFFFF" />
    </svg>
  `.trim()

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function getInvisibleConstraintSpriteIcon(
  objType: InvisibleConstraintObject['kind']['constraint']['type']
) {
  switch (objType) {
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
