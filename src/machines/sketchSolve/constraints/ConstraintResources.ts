import {
  DISTANCE_CONSTRAINT_ARROW,
  SEGMENT_WIDTH_PX,
} from '@src/clientSideScene/sceneConstants'
import {
  SKETCH_HIGHLIGHT_COLOR,
  SKETCH_SELECTION_COLOR,
} from '@src/lib/constants'
import { setupConstructionLineDashShader } from '@src/machines/sketchSolve/constructionDashShader'
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  type Group,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial'


export type ConstraintLineStyle = 'solid' | 'dashed'

type DashedLineUserData = {
  dashedMaterial?: LineMaterial
  hasDashedShader?: boolean
  segmentStart?: Vector3
  segmentEnd?: Vector3
}

function createLineMaterial(color: number, dashed = false) {
  return new LineMaterial({
    color,
    linewidth: SEGMENT_WIDTH_PX * window.devicePixelRatio,
    worldUnits: false,
    dashed,
    dashSize: 8,
    gapSize: 6,
  })
}

export class ConstraintResources {
  arrowGeometry = createArrowGeometry()

  materials = {
    default: {
      arrow: new MeshBasicMaterial({ color: 0xff0000, side: DoubleSide }),
      line: createLineMaterial(0xff0000),
      lineDashed: createLineMaterial(0xff0000, true),
    },
    hovered: {
      arrow: new MeshBasicMaterial({
        color: SKETCH_SELECTION_COLOR,
        side: DoubleSide,
      }),
      line: createLineMaterial(SKETCH_SELECTION_COLOR),
      lineDashed: createLineMaterial(SKETCH_SELECTION_COLOR, true),
    },
    selected: {
      arrow: new MeshBasicMaterial({
        color: SKETCH_HIGHLIGHT_COLOR,
        side: DoubleSide,
      }),
      line: createLineMaterial(SKETCH_HIGHLIGHT_COLOR),
      lineDashed: createLineMaterial(SKETCH_HIGHLIGHT_COLOR, true),
    },
  }

  public updateMaterials(constraintColor: number) {
    // Update default materials with theme color
    this.materials.default.line.color.set(constraintColor)
    this.materials.default.lineDashed.color.set(constraintColor)
    this.materials.default.arrow.color.set(constraintColor)
    const linewidth = SEGMENT_WIDTH_PX * window.devicePixelRatio
    this.materials.default.line.linewidth = linewidth
    this.materials.default.lineDashed.linewidth = linewidth
    this.materials.hovered.line.linewidth = linewidth
    this.materials.hovered.lineDashed.linewidth = linewidth
    this.materials.selected.line.linewidth = linewidth
    this.materials.selected.lineDashed.linewidth = linewidth
  }

  public updateConstraintGroup(
    group: Group,
    objId: number,
    selectedIds: number[],
    hoveredId: number | null,
    lineStyle: ConstraintLineStyle = 'solid'
  ) {
    const materialSet = this.getMaterialSet(objId, selectedIds, hoveredId)

    // Swap materials on lines and arrows
    for (const child of group.children) {
      if (child instanceof Line2) {
        child.material =
          lineStyle === 'dashed'
            ? this.getDashedLineMaterial(child, materialSet.lineDashed)
            : materialSet.line
      } else if (
        child instanceof Mesh &&
        child.userData.type === DISTANCE_CONSTRAINT_ARROW
      ) {
        child.material = materialSet.arrow
      }
    }
  }

  public getConstraintColor(
    objId: number,
    selectedIds: number[],
    hoveredId: number | null
  ) {
    return this.getMaterialSet(
      objId,
      selectedIds,
      hoveredId
    ).line.color.getHex()
  }

  private getMaterialSet(
    objId: number,
    selectedIds: number[],
    hoveredId: number | null
  ) {
    const isSelected = selectedIds.includes(objId)
    const isHovered = hoveredId === objId

    return isHovered
      ? this.materials.hovered
      : isSelected
        ? this.materials.selected
        : this.materials.default
  }

  private getDashedLineMaterial(line: Line2, baseMaterial: LineMaterial) {
    const userData = line.userData as DashedLineUserData
    const segmentStart = (userData.segmentStart ??= new Vector3())
    const segmentEnd = (userData.segmentEnd ??= new Vector3())
    const dashedMaterial =
      userData.dashedMaterial ??
      (userData.dashedMaterial = baseMaterial.clone())

    if (userData.hasDashedShader !== true) {
      setupConstructionLineDashShader(dashedMaterial, segmentStart, segmentEnd)
      userData.hasDashedShader = true
    }

    dashedMaterial.color.copy(baseMaterial.color)
    dashedMaterial.linewidth = baseMaterial.linewidth
    dashedMaterial.dashSize = baseMaterial.dashSize
    dashedMaterial.gapSize = baseMaterial.gapSize
    dashedMaterial.dashScale = baseMaterial.dashScale
    dashedMaterial.dashOffset = baseMaterial.dashOffset

    return dashedMaterial
  }
}

// Arrow with tip at origin, pointing +Y, base extends into -Y
function createArrowGeometry(): BufferGeometry {
  const geom = new BufferGeometry()
  const vertices = new Float32Array([
    -3.5,
    -10,
    0, // bottom left
    0,
    0,
    0, // tip at origin
    3.5,
    -10,
    0, // bottom right
  ])
  geom.setAttribute('position', new Float32BufferAttribute(vertices, 3))
  return geom
}
