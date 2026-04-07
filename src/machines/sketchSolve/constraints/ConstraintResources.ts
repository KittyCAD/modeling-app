import {
  DISTANCE_CONSTRAINT_ARROW,
  SEGMENT_WIDTH_PX,
} from '@src/clientSideScene/sceneConstants'
import {
  SKETCH_HIGHLIGHT_COLOR,
  SKETCH_SELECTION_COLOR,
} from '@src/lib/constants'
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  type Group,
  Mesh,
  MeshBasicMaterial,
} from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial'

export class ConstraintResources {
  arrowGeometry = createArrowGeometry()

  materials = {
    default: {
      arrow: new MeshBasicMaterial({ color: 0xff0000, side: DoubleSide }),
      line: new LineMaterial({
        color: 0xff0000,
        linewidth: SEGMENT_WIDTH_PX * window.devicePixelRatio,
        worldUnits: false,
      }),
    },
    hovered: {
      arrow: new MeshBasicMaterial({
        color: SKETCH_SELECTION_COLOR,
        side: DoubleSide,
      }),
      line: new LineMaterial({
        color: SKETCH_SELECTION_COLOR,
        linewidth: SEGMENT_WIDTH_PX * window.devicePixelRatio,
        worldUnits: false,
      }),
    },
    selected: {
      arrow: new MeshBasicMaterial({
        color: SKETCH_HIGHLIGHT_COLOR,
        side: DoubleSide,
      }),
      line: new LineMaterial({
        color: SKETCH_HIGHLIGHT_COLOR,
        linewidth: SEGMENT_WIDTH_PX * window.devicePixelRatio,
        worldUnits: false,
      }),
    },
  }

  public updateMaterials(constraintColor: number) {
    // Update default materials with theme color
    this.materials.default.line.color.set(constraintColor)
    this.materials.default.arrow.color.set(constraintColor)
    const linewidth = SEGMENT_WIDTH_PX * window.devicePixelRatio
    this.materials.default.line.linewidth = linewidth
    this.materials.hovered.line.linewidth = linewidth
    this.materials.selected.line.linewidth = linewidth
  }

  public updateConstraintGroup(
    group: Group,
    objId: number,
    selectedIds: number[],
    hoveredId: number | null
  ) {
    const materialSet = this.getMaterialSet(objId, selectedIds, hoveredId)

    // Swap materials on lines and arrows
    for (const child of group.children) {
      if (child instanceof Line2) {
        child.material = materialSet.line
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
