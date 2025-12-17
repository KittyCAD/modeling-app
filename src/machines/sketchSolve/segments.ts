import type { SegmentCtor } from '@rust/kcl-lib/bindings/FrontendApi'
import {
  SKETCH_LAYER,
  SKETCH_POINT_HANDLE,
  SKETCH_SOLVE_GROUP,
} from '@src/clientSideScene/sceneUtils'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { type Themes } from '@src/lib/theme'
import {
  BufferGeometry,
  ExtrudeGeometry,
  Group,
  Line,
  LineBasicMaterial,
  LineCurve3,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'
import {
  createLineShape,
  createArcGeometry,
} from '@src/clientSideScene/segments'
import { STRAIGHT_SEGMENT_BODY } from '@src/clientSideScene/sceneConstants'
import {
  KCL_DEFAULT_COLOR,
  packRgbToColor,
  SKETCH_SELECTION_COLOR,
  SKETCH_SELECTION_RGB,
  SKETCH_SELECTION_RGB_STR,
} from '@src/lib/constants'

export const SEGMENT_TYPE_POINT = 'POINT'
export const SEGMENT_TYPE_LINE = 'LINE'
export const SEGMENT_TYPE_ARC = 'ARC'
export const ARC_SEGMENT_BODY = 'ARC_SEGMENT_BODY'
export const ARC_PREVIEW_CIRCLE = 'arc-preview-circle'

interface CreateSegmentArgs {
  input: SegmentCtor
  theme: Themes
  id: number
  scale: number
  isDraft?: boolean
}

interface UpdateSegmentArgs {
  input: SegmentCtor
  theme: Themes
  id: number
  scale: number
  group: Group
  selectedIds: Array<number>
  isDraft?: boolean
}

/**
 * Utility interface for creating and updating sketch scene entities in Three.js.
 *
 * This interface provides a consistent pattern for rendering various sketch entities
 * (segments, constraints, points, etc.) in the 3D scene. Implementations handle both
 * the initial creation of Three.js objects and their subsequent updates as the sketch
 * state changes.
 *
 * The pattern separates initialization (creating the Three.js Group and its children)
 * from updates (modifying positions, sizes, colors, etc.) to avoid code duplication
 * and ensure consistent behavior across different entity types.
 *
 * if the sketchSolve machine is responsible for drawing the sketch scene, then this is
 * how it does it.
 */
export interface SketchEntityUtils {
  /**
   * Initializes a new Three.js Group for a sketch entity (segment, constraint, point, etc.).
   *
   * This method is responsible for:
   * - Creating a new Three.js Group
   * - Adding all necessary Three.js objects (meshes, CSS2DObjects, etc.) to the group
   * - Setting up event listeners for interactive elements (e.g., hover handlers)
   * - Setting important metadata like `mesh.name` and `mesh.userData.type` for later identification
   * - Configuring the group's `name` and `userData` properties
   *
   * The method should call `update` at the end to position and style the entities correctly,
   * avoiding duplication of positioning logic between init and update.
   */
  init: (args: CreateSegmentArgs) => Group | Error
  /**
   * Updates an existing sketch entity's visual representation based on current state.
   *
   * This method is responsible for:
   * - Updating positions and sizes of Three.js objects based on input data
   * - Updating colors and materials based on selection, hover, and draft states
   * - Updating geometry when entity properties change (e.g., line endpoints, arc parameters)
   * - Synchronizing visual state with the entity's data model
   *
   * The method is called both during initialization (from `init`) and when the entity
   * needs to be updated due to state changes (e.g., selection, position updates).
   */
  update: (args: UpdateSegmentArgs) => undefined | Error
}

class PointSegment implements SketchEntityUtils {
  /**
   * Updates the inner circle colors based on selection state
   */
  private updatePointColors(
    innerCircle: HTMLElement,
    status: {
      isSelected: boolean
      isHovered: boolean
      isDraft?: boolean
    }
  ): void {
    // Draft segments are grey
    if (status.isDraft) {
      innerCircle.style.backgroundColor = '#888888'
      innerCircle.style.border = '0px solid #CCCCCC'
      return // draft styles take precedence
    }
    if (status.isHovered) {
      // Calculate darker version of SKETCH_SELECTION_COLOR (70% brightness)
      const darkerSelectionRgb = SKETCH_SELECTION_RGB.map((val) =>
        Math.round(val * 0.7)
      )
      const darkerSelectionRgbStr = darkerSelectionRgb.join(', ')
      innerCircle.style.backgroundColor = `rgb(${darkerSelectionRgbStr})`
      innerCircle.style.border = `1px solid rgba(${darkerSelectionRgbStr}, 0.5)`
      return // Hover styles take precedence over isSelection status
    }
    innerCircle.style.backgroundColor = status.isSelected
      ? `rgb(${SKETCH_SELECTION_RGB_STR})`
      : KCL_DEFAULT_COLOR
    innerCircle.style.border = status.isSelected
      ? `2px solid rgba(${SKETCH_SELECTION_RGB_STR}, 0.5)`
      : '0px solid #CCCCCC'
  }

  private updatePointSize(innerCircle: HTMLElement, isHovered = false) {
    innerCircle.style.width = isHovered ? '10px' : '6px'
    innerCircle.style.height = isHovered ? '10px' : '6px'
  }

  private createPointHtml(segmentId: number) {
    const [handleDiv, innerCircle] = htmlHelper`
      <div
          data-segment_id="${String(segmentId)}"
          ${{ key: 'handle', value: SKETCH_POINT_HANDLE }}
          style="
          width: 30px;
          height: 30px;
          position: absolute;
          pointer-events: auto;
          transform: translate(-50%, -50%);
          "
          >
          <div
            ${{ key: 'id', value: 'inner-circle' }}
            data-point-inner-circle="true"
            style="
              position: absolute;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
              width: 6px;
              height: 6px;
              border-radius: 50%;
              transition: width 0.15s ease, height 0.15s ease, background-color 0.15s ease, border-color 0.15s ease;
            "
          ></div>
        </div>
      `
    return { handleDiv, innerCircle }
  }

  init = (args: CreateSegmentArgs) => {
    if (args.input.type !== 'Point') {
      return new Error('Invalid input type for PointSegment')
    }
    const segmentGroup = new Group()

    // Create a 2D box using CSS2DObject
    const { handleDiv, innerCircle } = this.createPointHtml(args.id)
    // Outer div is larger for hitbox, inner div is smaller visually

    // Hover styles
    handleDiv.addEventListener('mouseenter', () => {
      this.updatePointSize(innerCircle, true)
      const isSelected = handleDiv.dataset.isSelected === 'true'
      const isDraft = handleDiv.dataset.isDraft === 'true'
      this.updatePointColors(innerCircle, {
        isSelected,
        isHovered: true,
        isDraft,
      })
    })

    handleDiv.addEventListener('mouseleave', () => {
      const isHovered = false
      this.updatePointSize(innerCircle, isHovered)
      // Restore colors based on selection state stored in data attribute
      const isSelected = handleDiv.dataset.isSelected === 'true'
      const isDraft = handleDiv.dataset.isDraft === 'true'
      this.updatePointColors(innerCircle, { isSelected, isHovered, isDraft })
    })

    const cssObject = new CSS2DObject(handleDiv)
    cssObject.userData.type = 'handle'
    cssObject.name = 'handle'

    segmentGroup.name = args.id.toString()
    segmentGroup.userData = {
      type: 'point',
    }
    segmentGroup.add(cssObject)

    this.update({
      input: args.input,
      theme: args.theme,
      id: args.id,
      scale: args.scale,
      group: segmentGroup,
      selectedIds: [],
      isDraft: args.isDraft,
    })
    return segmentGroup
  }

  update(args: UpdateSegmentArgs) {
    if (args.input.type !== 'Point') {
      return new Error('Invalid input type for PointSegment')
    }
    const { input, group, scale, selectedIds, id, isDraft } = args
    const { x, y } = input.position
    if (!('value' in x && 'value' in y)) {
      return new Error('Invalid position values for PointSegment')
    }
    group.scale.set(scale, scale, scale)
    const handle = group.getObjectByName('handle')
    if (handle && handle instanceof CSS2DObject) {
      handle.position.set(x.value / scale, y.value / scale, 0)

      // Update selected styling based on whether this segment id is selected
      const el = handle.element
      const innerCircle = el.querySelector('div')
      if (!innerCircle) return

      const isSelected = selectedIds.includes(id)
      // Store selection state in data attribute for hover handlers
      el.dataset.isSelected = String(isSelected)
      // Store draft state in data attribute for hover handlers
      el.dataset.isDraft = String(isDraft ?? false)

      // Only update colors if not hovering (hover styles take precedence)
      if (!el.matches(':hover')) {
        this.updatePointColors(innerCircle, {
          isSelected,
          isHovered: false,
          isDraft,
        })
      }
    }
  }
}

class LineSegment implements SketchEntityUtils {
  /**
   * Updates the line segment mesh color based on selection and hover state
   */
  updateLineColors(
    mesh: Mesh,
    isSelected: boolean,
    isHovered: boolean,
    isDraft?: boolean
  ): void {
    const material = mesh.material
    if (!(material instanceof MeshBasicMaterial)) {
      return
    }

    if (isHovered) {
      material.color.set(
        packRgbToColor(SKETCH_SELECTION_RGB.map((val) => Math.round(val * 0.7)))
      )
    } else if (isSelected) {
      material.color.set(SKETCH_SELECTION_COLOR)
    } else if (isDraft) {
      // Draft segments are grey (0x888888)
      material.color.set(0x888888)
    } else {
      material.color.set(KCL_DEFAULT_COLOR)
    }
  }

  init = (args: CreateSegmentArgs) => {
    if (args.input.type !== 'Line') {
      return new Error('Invalid input type for PointSegment')
    }
    const { input, theme, id, scale } = args
    if (
      !(
        'value' in input.start.x &&
        'value' in input.start.y &&
        'value' in input.end.x &&
        'value' in input.end.y
      )
    ) {
      return new Error('Invalid position values for LineSegment')
    }
    const startX = input.start.x.value
    const startY = input.start.y.value
    const endX = input.end.x.value
    const endY = input.end.y.value
    const segmentGroup = new Group()
    const line = new LineCurve3(
      new Vector3(startX / scale, startY / scale, 0),
      new Vector3(endX / scale, endY / scale, 0)
    )
    const geometry = new ExtrudeGeometry(createLineShape(scale), {
      steps: 2,
      bevelEnabled: false,
      extrudePath: line,
    })
    const body = new MeshBasicMaterial({ color: KCL_DEFAULT_COLOR })
    const mesh = new Mesh(geometry, body)

    mesh.userData.type = STRAIGHT_SEGMENT_BODY
    mesh.name = STRAIGHT_SEGMENT_BODY
    segmentGroup.name = id.toString()
    segmentGroup.userData = {
      type: SEGMENT_TYPE_LINE,
    }

    segmentGroup.add(mesh)

    this.update({
      input: input,
      theme: theme,
      id: id,
      scale: scale,
      group: segmentGroup,
      selectedIds: [],
      isDraft: args.isDraft,
    })

    return segmentGroup
  }
  update(args: UpdateSegmentArgs) {
    if (args.input.type !== 'Line') {
      return new Error('Invalid input type for PointSegment')
    }
    const { input, group, id, scale, selectedIds, isDraft } = args
    if (
      !(
        'value' in input.start.x &&
        'value' in input.start.y &&
        'value' in input.end.x &&
        'value' in input.end.y
      )
    ) {
      return new Error('Invalid position values for LineSegment')
    }
    const shape = createLineShape(scale)

    const straightSegmentBody = group.children.find(
      (child) => child.userData.type === STRAIGHT_SEGMENT_BODY
    )
    if (!(straightSegmentBody && straightSegmentBody instanceof Mesh)) {
      console.error('No straight segment body found in group')
      return
    }

    const line = new LineCurve3(
      new Vector3(input.start.x.value, input.start.y.value, 0),
      new Vector3(input.end.x.value, input.end.y.value, 0)
    )
    straightSegmentBody.geometry.dispose()
    straightSegmentBody.geometry = new ExtrudeGeometry(shape, {
      steps: 2,
      bevelEnabled: false,
      extrudePath: line,
    })

    // Update mesh color based on selection
    const isSelected = selectedIds.includes(id)
    // Check if this segment is currently hovered (stored in userData)
    const isHovered = straightSegmentBody.userData.isHovered === true
    this.updateLineColors(straightSegmentBody, isSelected, isHovered, isDraft)
  }
}

class ArcSegment implements SketchEntityUtils {
  /**
   * Updates the arc segment mesh color based on selection and hover state
   */
  updateArcColors(
    mesh: Mesh,
    isSelected: boolean,
    isHovered: boolean,
    isDraft?: boolean
  ): void {
    const material = mesh.material
    if (!(material instanceof MeshBasicMaterial)) {
      return
    }

    if (isHovered) {
      material.color.set(
        packRgbToColor(SKETCH_SELECTION_RGB.map((val) => Math.round(val * 0.7)))
      )
    } else if (isSelected) {
      material.color.set(SKETCH_SELECTION_COLOR)
    } else if (isDraft) {
      // Draft segments are grey (0x888888)
      material.color.set(0x888888)
    } else {
      material.color.set(KCL_DEFAULT_COLOR)
    }
  }

  /**
   * Ensures there is a preview circle for a center arc and updates its radius.
   * The preview circle is a simple gray line loop that lives in the sketch solve group.
   */
  updatePreviewCircle({
    sceneInfra,
    center,
    radius,
  }: {
    sceneInfra: SceneInfra
    center: [number, number]
    radius: number
  }): void {
    if (!Number.isFinite(radius) || radius < 1e-6) return

    const sketchGroup =
      sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP) ?? sceneInfra.scene

    let preview = sketchGroup.getObjectByName(ARC_PREVIEW_CIRCLE) as Line | null

    const segments = 64
    const points = []
    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) * Math.PI * 2
      const x = center[0] + radius * Math.cos(t)
      const y = center[1] + radius * Math.sin(t)
      points.push(new Vector3(x, y, 0))
    }
    const geometry = new BufferGeometry().setFromPoints(points)

    if (!preview) {
      const material = new LineBasicMaterial({ color: 0x888888 })
      preview = new Line(geometry, material)
      preview.name = ARC_PREVIEW_CIRCLE
      preview.layers.set(SKETCH_LAYER)
      sketchGroup.add(preview)
    } else {
      preview.geometry.dispose()
      preview.geometry = geometry
    }
  }

  /**
   * Removes and disposes the preview circle if it exists.
   */
  removePreviewCircle(sceneInfra: SceneInfra): void {
    const sketchGroup =
      sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP) ?? sceneInfra.scene
    const preview = sketchGroup.getObjectByName(ARC_PREVIEW_CIRCLE)
    if (preview instanceof Line) {
      preview.geometry.dispose()
      if (preview.material instanceof LineBasicMaterial) {
        preview.material.dispose()
      }
      preview.parent?.remove(preview)
    }
  }

  init = (args: CreateSegmentArgs) => {
    if (args.input.type !== 'Arc') {
      return new Error('Invalid input type for ArcSegment')
    }
    const { input, theme, id, scale } = args
    if (
      !(
        'value' in input.center.x &&
        'value' in input.center.y &&
        'value' in input.start.x &&
        'value' in input.start.y &&
        'value' in input.end.x &&
        'value' in input.end.y
      )
    ) {
      return new Error('Invalid position values for ArcSegment')
    }

    const centerX = input.center.x.value
    const centerY = input.center.y.value
    const startX = input.start.x.value
    const startY = input.start.y.value
    const endX = input.end.x.value
    const endY = input.end.y.value

    // Calculate radius (distance from center to start point)
    // For a center arc, both start and end should be at the same radius from center
    const dxStart = startX - centerX
    const dyStart = startY - centerY
    const radiusStart = Math.sqrt(dxStart * dxStart + dyStart * dyStart)

    const dxEnd = endX - centerX
    const dyEnd = endY - centerY
    const radiusEnd = Math.sqrt(dxEnd * dxEnd + dyEnd * dyEnd)

    // Use average radius in case of small floating point differences
    const radius = (radiusStart + radiusEnd) / 2

    // Calculate angles
    const startAngle = Math.atan2(startY - centerY, startX - centerX)
    const endAngle = Math.atan2(endY - centerY, endX - centerX)

    // Always draw arcs CCW from start to end.
    // The solver also uses a CCW convention from start to end, so we keep
    // the angles as-is and force ccw = true to match that behaviour.
    const ccw = true

    const segmentGroup = new Group()
    // Coordinates need to be divided by scale to match LineSegment pattern
    // The geometry is created in local space, then scaled by the group
    // Draft arcs should be grey but NOT dashed (different design direction from clientSideScene)
    const geometry = createArcGeometry({
      center: [centerX, centerY],
      radius,
      startAngle,
      endAngle,
      ccw,
      isDashed: false,
      scale,
    })
    const body = new MeshBasicMaterial({ color: KCL_DEFAULT_COLOR })
    const mesh = new Mesh(geometry, body)

    mesh.userData.type = ARC_SEGMENT_BODY
    mesh.name = ARC_SEGMENT_BODY
    segmentGroup.name = id.toString()
    segmentGroup.userData = {
      type: SEGMENT_TYPE_ARC,
    }

    segmentGroup.add(mesh)

    this.update({
      input: input,
      theme: theme,
      id: id,
      scale: scale,
      group: segmentGroup,
      selectedIds: [],
      isDraft: args.isDraft,
    })

    return segmentGroup
  }

  update(args: UpdateSegmentArgs) {
    if (args.input.type !== 'Arc') {
      return new Error('Invalid input type for ArcSegment')
    }
    const { input, group, id, scale, selectedIds, isDraft } = args
    if (
      !(
        'value' in input.center.x &&
        'value' in input.center.y &&
        'value' in input.start.x &&
        'value' in input.start.y &&
        'value' in input.end.x &&
        'value' in input.end.y
      )
    ) {
      return new Error('Invalid position values for ArcSegment')
    }

    const centerX = input.center.x.value
    const centerY = input.center.y.value
    const startX = input.start.x.value
    const startY = input.start.y.value
    const endX = input.end.x.value
    const endY = input.end.y.value

    // Calculate radius (distance from center to start/end points)
    // For a center arc, both start and end should be at the same radius from center
    const dxStart = startX - centerX
    const dyStart = startY - centerY
    const radiusStart = Math.sqrt(dxStart * dxStart + dyStart * dyStart)

    const dxEnd = endX - centerX
    const dyEnd = endY - centerY
    const radiusEnd = Math.sqrt(dxEnd * dxEnd + dyEnd * dyEnd)

    // Use average radius in case of small floating point differences
    const radius = (radiusStart + radiusEnd) / 2

    // Calculate angles
    const startAngle = Math.atan2(startY - centerY, startX - centerX)
    const endAngle = Math.atan2(endY - centerY, endX - centerX)

    // Always draw arcs CCW from start to end to match the solver.
    const ccw = true

    const arcSegmentBody = group.children.find(
      (child) => child.userData.type === ARC_SEGMENT_BODY
    )
    if (!(arcSegmentBody && arcSegmentBody instanceof Mesh)) {
      console.error('No arc segment body found in group')
      return
    }

    // Match LineSegment.update pattern: use coordinates directly (not divided by scale)
    // LineSegment.update uses input.start.x.value directly without dividing by scale
    // The client-side scene also passes coordinates directly to createArcGeometry (not divided by scale)
    // So we should use coordinates directly here too (not divided by scale)
    // Draft arcs should be grey but NOT dashed (different design direction from clientSideScene)
    const newGeometry = createArcGeometry({
      center: [centerX, centerY],
      radius: radius,
      startAngle,
      endAngle,
      ccw,
      isDashed: false,
      scale,
    })
    arcSegmentBody.geometry.dispose()
    arcSegmentBody.geometry = newGeometry

    // Update mesh color based on selection
    const isSelected = selectedIds.includes(id)
    // Check if this segment is currently hovered (stored in userData)
    const isHovered = arcSegmentBody.userData.isHovered === true
    this.updateArcColors(arcSegmentBody, isSelected, isHovered, isDraft)
  }
}

/**
 * Updates the hover state of a segment mesh (line or arc)
 */
export function updateSegmentHover(
  mesh: Mesh | null,
  isHovered: boolean,
  selectedIds: Array<number>,
  draftEntityIds?: Array<number>
): void {
  if (!mesh) {
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
  const isDraft = draftEntityIds?.includes(segmentId) ?? false

  // Dispatch based on segment body type
  if (mesh.userData.type === STRAIGHT_SEGMENT_BODY) {
    segmentUtilsMap.LineSegment.updateLineColors(
      mesh,
      isSelected,
      isHovered,
      isDraft
    )
  } else if (mesh.userData.type === ARC_SEGMENT_BODY) {
    segmentUtilsMap.ArcSegment.updateArcColors(
      mesh,
      isSelected,
      isHovered,
      isDraft
    )
  }
}

/**
 * Tagged template literal helper for creating HTML elements from template strings.
 *
 * Creates DOM elements from HTML template strings and returns elements that have
 * data attributes defined using the `{key, value}` object syntax. Elements are
 * returned in the order their data attributes appear in the template.
 *
 * Use to help with CSS2DObjects
 *
 * @param strings - Template string parts (from template literal)
 * @param values - Interpolated values. Can be:
 *   - `string`: Regular string interpolation (not included in return array)
 *   - `{key: string, value: string}`: Creates a `data-${key}="${value}"` attribute
 *     and includes the element in the returned array
 *
 * @returns Array of HTMLElements that have data attributes defined via `{key, value}` objects,
 *          in the order they appear in the template
 *
 * @example
 * ```ts
 * const [outerDiv, innerDiv] = htmlHelper`
 *   <div ${{key: 'segment_id', value: '123'}} style="width: 30px;">
 *     <div ${{key: 'id', value: 'inner-circle'}} style="width: 6px;"></div>
 *   </div>
 * `
 * // outerDiv has data-segment_id="123"
 * // innerDiv has data-id="inner-circle"
 * ```
 *
 * @example
 * ```ts
 * const [element] = htmlHelper`
 *   <div ${{key: 'handle', value: 'point-handle'}}>
 *     ${someStringVariable}
 *   </div>
 * `
 * // element has data-handle="point-handle"
 * // String interpolations (like someStringVariable) are included in HTML but
 * // their elements are not returned unless they have data attributes
 * ```
 */
export function htmlHelper(
  strings: TemplateStringsArray,
  ...values: Array<{ key: string; value: string } | string>
): Array<HTMLElement> {
  const template = document.createElement('template')
  let result = ''
  const queryStrings: Array<string> = []
  strings.forEach((str, i) => {
    result += str
    if (i < values.length) {
      // v
      const currentValue = values[i]
      if (typeof currentValue === 'string') {
        result += currentValue
      } else {
        const { key, value } = currentValue
        const dataDashValue = `data-${key}="${value}"`
        result += dataDashValue
        queryStrings.push(`[${dataDashValue}]`)
      }
    }
  })
  template.innerHTML = result
  const elements: Array<HTMLElement> = []
  queryStrings.forEach((qs) => {
    const el = template.content.querySelector(qs)
    if (el instanceof HTMLElement) {
      elements.push(el)
    }
  })

  return elements
}

export const segmentUtilsMap = {
  PointSegment: new PointSegment(),
  LineSegment: new LineSegment(),
  ArcSegment: new ArcSegment(),
}
