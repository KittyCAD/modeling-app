import type {
  SceneGraphDelta,
  SegmentCtor,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { SKETCH_POINT_HANDLE } from '@src/clientSideScene/sceneUtils'
import { type Themes } from '@src/lib/theme'
import {
  ExtrudeGeometry,
  Group,
  LineCurve3,
  Mesh,
  MeshBasicMaterial,
  Shape,
  Vector3,
} from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { createLineShape } from '@src/clientSideScene/segments'
import { STRAIGHT_SEGMENT_BODY } from '@src/clientSideScene/sceneConstants'
import {
  KCL_DEFAULT_COLOR,
  SKETCH_SELECTION_COLOR,
  SKETCH_SELECTION_RGB,
  SKETCH_SELECTION_RGB_STR,
} from '@src/lib/constants'

export const SEGMENT_TYPE_POINT = 'POINT'
export const SEGMENT_TYPE_LINE = 'LINE'

interface CreateSegmentArgs {
  input: SegmentCtor
  theme: Themes
  id: number
  scale: number
  onUpdateSketchOutcome?: (data: {
    kclSource: SourceDelta
    sceneGraphDelta: SceneGraphDelta
  }) => void
}

interface UpdateSegmentArgs {
  input: SegmentCtor
  theme: Themes
  id: number
  scale: number
  group: Group
  selectedIds: Array<number>
}

export interface SegmentUtils {
  /**
   * the init is responsible for adding all of the correct entities to the group with important details like `mesh.name = ...`
   * as these act like handles later
   *
   * It's **Not** responsible for doing all calculations to size and position the entities as this would be duplicated in the update function
   * Which should instead be called at the end of the init function
   */
  init: (args: CreateSegmentArgs) => Promise<Group>
  /**
   * The update function is responsible for updating the group with the correct size and position of the entities
   * It should be called at the end of the init function and return a callback that can be used to update the overlay
   *
   * It returns a callback for updating the overlays, this is so the overlays do not have to update at the same pace threeJs does
   * This is useful for performance reasons
   */
  update: (args: UpdateSegmentArgs) => any
}

class PointSegment implements SegmentUtils {
  /**
   * Updates the inner circle colors based on selection state
   */
  private updatePointColors(
    innerCircle: HTMLElement,
    isSelected: boolean
  ): void {
    innerCircle.style.backgroundColor = isSelected
      ? `rgb(${SKETCH_SELECTION_RGB_STR})`
      : KCL_DEFAULT_COLOR
    innerCircle.style.border = isSelected
      ? `2px solid rgba(${SKETCH_SELECTION_RGB_STR}, 0.5)`
      : '0px solid #CCCCCC'
  }

  init = async (args: CreateSegmentArgs) => {
    if (args.input.type !== 'Point') {
      return Promise.reject(new Error('Invalid input type for PointSegment'))
    }
    const segmentGroup = new Group()

    // Create a 2D box using CSS2DObject
    // Outer div is larger for hitbox, inner div is smaller visually
    const handleDiv = document.createElement('div')
    handleDiv.dataset.segment_id = String(args.id)
    handleDiv.dataset.handle = SKETCH_POINT_HANDLE
    handleDiv.style.width = '30px'
    handleDiv.style.height = '30px'
    handleDiv.style.position = 'absolute'
    handleDiv.style.pointerEvents = 'auto'
    handleDiv.style.transform = 'translate(-50%, -50%)'

    // Inner div for the visual circle - absolutely positioned to center it
    const innerCircle = document.createElement('div')
    innerCircle.style.position = 'absolute'
    innerCircle.style.top = '50%'
    innerCircle.style.left = '50%'
    innerCircle.style.transform = 'translate(-50%, -50%)'
    innerCircle.style.width = '6px'
    innerCircle.style.height = '6px'
    innerCircle.style.borderRadius = '50%'
    innerCircle.style.transition =
      'width 0.15s ease, height 0.15s ease, background-color 0.15s ease, border-color 0.15s ease'

    // Calculate darker version of SKETCH_SELECTION_COLOR (70% brightness)
    const darkerSelectionRgb = SKETCH_SELECTION_RGB.map((val) =>
      Math.round(val * 0.7)
    )
    const darkerSelectionRgbStr = darkerSelectionRgb.join(', ')

    // Hover styles
    handleDiv.addEventListener('mouseenter', () => {
      innerCircle.style.width = '10px'
      innerCircle.style.height = '10px'
      innerCircle.style.backgroundColor = `rgb(${darkerSelectionRgbStr})`
      innerCircle.style.border = `1px solid rgba(${darkerSelectionRgbStr}, 0.5)`
    })

    handleDiv.addEventListener('mouseleave', () => {
      innerCircle.style.width = '6px'
      innerCircle.style.height = '6px'
      // Restore colors based on selection state stored in data attribute
      const isSelected = handleDiv.dataset.isSelected === 'true'
      this.updatePointColors(innerCircle, isSelected)
    })

    handleDiv.appendChild(innerCircle)

    const cssObject = new CSS2DObject(handleDiv)
    cssObject.userData.type = 'handle'
    cssObject.name = 'handle'

    segmentGroup.name = args.id.toString()
    segmentGroup.userData = {
      type: 'point',
    }
    segmentGroup.add(cssObject)

    await this.update({
      input: args.input,
      theme: args.theme,
      id: args.id,
      scale: args.scale,
      group: segmentGroup,
      selectedIds: [],
    })
    return segmentGroup
  }

  update(args: UpdateSegmentArgs) {
    if (args.input.type !== 'Point') {
      return Promise.reject(new Error('Invalid input type for PointSegment'))
    }
    const { x, y } = args.input.position
    if (!('value' in x && 'value' in y)) {
      return Promise.reject(
        new Error('Invalid position values for PointSegment')
      )
    }
    args.group.scale.set(args.scale, args.scale, args.scale)
    const handle = args.group.getObjectByName('handle')
    if (handle && handle instanceof CSS2DObject) {
      handle.position.set(x.value / args.scale, y.value / args.scale, 0)

      // Update selected styling based on whether this segment id is selected
      const el = handle.element
      const innerCircle = el.querySelector('div')
      if (!innerCircle) return

      const isSelected = args.selectedIds.includes(args.id)
      // Store selection state in data attribute for hover handlers
      el.dataset.isSelected = String(isSelected)

      // Only update colors if not hovering (hover styles take precedence)
      if (!el.matches(':hover')) {
        this.updatePointColors(innerCircle, isSelected)
      }
    }
  }
}

class LineSegment implements SegmentUtils {
  /**
   * Updates the line segment mesh color based on selection and hover state
   */
  updateLineColors(mesh: Mesh, isSelected: boolean, isHovered: boolean): void {
    // Calculate darker version of SKETCH_SELECTION_COLOR (70% brightness)
    const darkerSelectionRgb = SKETCH_SELECTION_RGB.map((val) =>
      Math.round(val * 0.7)
    )
    const darkerSelectionColor =
      (darkerSelectionRgb[0] << 16) |
      (darkerSelectionRgb[1] << 8) |
      darkerSelectionRgb[2]

    const material = mesh.material
    if (!(material instanceof MeshBasicMaterial)) {
      return
    }

    if (isHovered) {
      material.color.set(darkerSelectionColor)
    } else if (isSelected) {
      material.color.set(SKETCH_SELECTION_COLOR)
    } else {
      material.color.set(KCL_DEFAULT_COLOR)
    }
  }

  init = async (args: CreateSegmentArgs) => {
    if (args.input.type !== 'Line') {
      return Promise.reject(new Error('Invalid input type for PointSegment'))
    }
    if (
      !(
        'value' in args.input.start.x &&
        'value' in args.input.start.y &&
        'value' in args.input.end.x &&
        'value' in args.input.end.y
      )
    ) {
      console.log('args.input', args.input)
      return Promise.reject(
        new Error('Invalid position values for LineSegment')
      )
    }
    const startX = args.input.start.x.value
    const startY = args.input.start.y.value
    const endX = args.input.end.x.value
    const endY = args.input.end.y.value
    const segmentGroup = new Group()
    const shape = new Shape()
    const line = new LineCurve3(
      new Vector3(startX / args.scale, startY / args.scale, 0),
      new Vector3(endX / args.scale, endY / args.scale, 0)
    )
    const geometry = new ExtrudeGeometry(shape, {
      steps: 2,
      bevelEnabled: false,
      extrudePath: line,
    })
    const body = new MeshBasicMaterial({ color: KCL_DEFAULT_COLOR })
    const mesh = new Mesh(geometry, body)

    mesh.userData.type = STRAIGHT_SEGMENT_BODY
    mesh.name = STRAIGHT_SEGMENT_BODY
    segmentGroup.name = args.id.toString()
    segmentGroup.userData = {
      type: SEGMENT_TYPE_LINE,
    }

    segmentGroup.add(mesh)

    await this.update({
      input: args.input,
      theme: args.theme,
      id: args.id,
      scale: args.scale,
      group: segmentGroup,
      selectedIds: [],
    })

    return segmentGroup
  }
  update(args: UpdateSegmentArgs) {
    if (args.input.type !== 'Line') {
      return Promise.reject(new Error('Invalid input type for PointSegment'))
    }
    if (
      !(
        'value' in args.input.start.x &&
        'value' in args.input.start.y &&
        'value' in args.input.end.x &&
        'value' in args.input.end.y
      )
    ) {
      return Promise.reject(
        new Error('Invalid position values for LineSegment')
      )
    }
    const shape = createLineShape(args.scale)

    const straightSegmentBody = args.group.children.find(
      (child) => child.userData.type === STRAIGHT_SEGMENT_BODY
    )
    if (!(straightSegmentBody && straightSegmentBody instanceof Mesh)) {
      console.error('No straight segment body found in group')
      return
    }

    const line = new LineCurve3(
      new Vector3(args.input.start.x.value, args.input.start.y.value, 0),
      new Vector3(args.input.end.x.value, args.input.end.y.value, 0)
    )
    straightSegmentBody.geometry.dispose()
    straightSegmentBody.geometry = new ExtrudeGeometry(shape, {
      steps: 2,
      bevelEnabled: false,
      extrudePath: line,
    })

    // Update mesh color based on selection
    const isSelected = args.selectedIds.includes(args.id)
    // Check if this segment is currently hovered (stored in userData)
    const isHovered = straightSegmentBody.userData.isHovered === true
    this.updateLineColors(straightSegmentBody, isSelected, isHovered)
  }
}

export const segmentUtilsMap = {
  PointSegment: new PointSegment(),
  LineSegment: new LineSegment(),
}

/**
 * Updates the hover state of a line segment mesh
 */
export function updateLineSegmentHover(
  mesh: Mesh | null,
  isHovered: boolean,
  selectedIds: Array<number>
): void {
  if (!mesh || mesh.userData.type !== STRAIGHT_SEGMENT_BODY) {
    return
  }

  // Store hover state in userData
  mesh.userData.isHovered = isHovered

  // Get the parent group to find the segment ID
  const group = mesh.parent
  if (!(group instanceof Group)) {
    return
  }

  const segmentId = Number(group.name)
  if (Number.isNaN(segmentId)) {
    return
  }

  const isSelected = selectedIds.includes(segmentId)
  segmentUtilsMap.LineSegment.updateLineColors(mesh, isSelected, isHovered)
}
