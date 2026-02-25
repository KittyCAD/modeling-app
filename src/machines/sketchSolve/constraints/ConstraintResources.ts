import {
  DISTANCE_CONSTRAINT_ARROW,
  SEGMENT_WIDTH_PX,
} from '@src/clientSideScene/sceneConstants'
import {
  packRgbToColor,
  SKETCH_SELECTION_COLOR,
  SKETCH_SELECTION_RGB,
} from '@src/lib/constants'
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  type Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial'

const debug_hit_areas = false

const HOVER_COLOR = packRgbToColor(
  SKETCH_SELECTION_RGB.map((val) => Math.round(val * 0.7))
)

export class ConstraintResources {
  arrowGeometry = createArrowGeometry()
  planeGeometry = new PlaneGeometry(1, 1)

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
        color: HOVER_COLOR,
        side: DoubleSide,
      }),
      line: new LineMaterial({
        color: HOVER_COLOR,
        linewidth: SEGMENT_WIDTH_PX * window.devicePixelRatio,
        worldUnits: false,
      }),
    },
    hitArea: new MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: debug_hit_areas ? 0.3 : 0,
      side: DoubleSide,
    }),
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
    // Pick material set based on hover/selected state
    const isSelected = selectedIds.includes(objId)
    const isHovered = hoveredId === objId
    const materialSet = isHovered
      ? this.materials.hovered
      : isSelected
        ? this.materials.selected
        : this.materials.default

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
