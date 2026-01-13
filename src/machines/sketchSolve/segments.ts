import type { SegmentCtor, Freedom } from '@rust/kcl-lib/bindings/FrontendApi'
import {
  SKETCH_LAYER,
  SKETCH_POINT_HANDLE,
  SKETCH_SOLVE_GROUP,
} from '@src/clientSideScene/sceneUtils'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { type Themes } from '@src/lib/theme'
import { hasNumericValue } from '@src/lib/kclHelpers'
import type { Mesh } from 'three'
import {
  BufferGeometry,
  EllipseCurve,
  Group,
  Line,
  LineBasicMaterial,
  Vector3,
} from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import {
  SEGMENT_WIDTH_PX,
  STRAIGHT_SEGMENT_BODY,
} from '@src/clientSideScene/sceneConstants'
import { KCL_DEFAULT_COLOR } from '@src/lib/constants'
// Import and re-export pure utility functions
import { getSegmentColor } from '@src/machines/sketchSolve/segmentsUtils'

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
  freedom?: Freedom | null
}

interface UpdateSegmentArgs {
  input: SegmentCtor
  theme: Themes
  id: number
  scale: number
  group: Group
  selectedIds: Array<number>
  isDraft?: boolean
  freedom?: Freedom | null
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
      freedom?: Freedom | null
    }
  ): void {
    // Use color precedence system
    const color = getSegmentColor({
      isDraft: status.isDraft,
      isHovered: status.isHovered,
      isSelected: status.isSelected,
      freedom: status.freedom,
    })

    // Convert hex color to RGB string for CSS
    const r = (color >> 16) & 0xff
    const g = (color >> 8) & 0xff
    const b = color & 0xff
    const rgbStr = `${r}, ${g}, ${b}`

    // Draft segments are grey
    if (status.isDraft) {
      innerCircle.style.backgroundColor = '#888888'
      innerCircle.style.border = '0px solid #CCCCCC'
      return // draft styles take precedence
    }
    if (status.isHovered) {
      // getSegmentColor already returns the hover color at 70% brightness
      innerCircle.style.backgroundColor = `rgb(${rgbStr})`
      innerCircle.style.border = `1px solid rgba(${rgbStr}, 0.5)`
      return // Hover styles take precedence
    }
    innerCircle.style.backgroundColor = `rgb(${rgbStr})`
    innerCircle.style.border = status.isSelected
      ? `2px solid rgba(${rgbStr}, 0.5)`
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
      const freedom = (handleDiv.dataset.freedom as Freedom | undefined) || null
      this.updatePointColors(innerCircle, {
        isSelected,
        isHovered: true,
        isDraft,
        freedom,
      })
    })

    handleDiv.addEventListener('mouseleave', () => {
      const isHovered = false
      this.updatePointSize(innerCircle, isHovered)
      // Restore colors based on selection state stored in data attribute
      const isSelected = handleDiv.dataset.isSelected === 'true'
      const isDraft = handleDiv.dataset.isDraft === 'true'
      const freedom = (handleDiv.dataset.freedom as Freedom | undefined) || null
      this.updatePointColors(innerCircle, {
        isSelected,
        isHovered,
        isDraft,
        freedom,
      })
    })

    const cssObject = new CSS2DObject(handleDiv)
    cssObject.userData.type = 'handle'
    cssObject.name = 'handle'

    segmentGroup.name = args.id.toString()
    segmentGroup.userData = {
      type: 'point',
    }
    segmentGroup.add(cssObject)

    // Store freedom in userData for later access
    segmentGroup.userData.freedom = args.freedom ?? null

    this.update({
      input: args.input,
      theme: args.theme,
      id: args.id,
      scale: args.scale,
      group: segmentGroup,
      selectedIds: [],
      isDraft: args.isDraft,
      freedom: args.freedom,
    })
    return segmentGroup
  }

  update(args: UpdateSegmentArgs) {
    if (args.input.type !== 'Point') {
      return new Error('Invalid input type for PointSegment')
    }
    const { input, group, scale, selectedIds, id, isDraft } = args
    const { x, y } = input.position
    if (!(hasNumericValue(x) && hasNumericValue(y))) {
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
      // Get freedom from args or group userData
      const freedom = args.freedom ?? group.userData.freedom ?? null
      // Update userData for consistency
      group.userData.freedom = freedom

      // Store selection state in data attribute for hover handlers
      el.dataset.isSelected = String(isSelected)
      // Store draft state in data attribute for hover handlers
      el.dataset.isDraft = String(isDraft ?? false)
      // Store freedom state in data attribute for hover handlers
      el.dataset.freedom = freedom ?? ''

      // Only update colors if not hovering (hover styles take precedence)
      if (!el.matches(':hover')) {
        this.updatePointColors(innerCircle, {
          isSelected,
          isHovered: false,
          isDraft,
          freedom,
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
    mesh: Line2,
    isSelected: boolean,
    isHovered: boolean,
    isDraft?: boolean,
    freedom?: Freedom | null
  ): void {
    updateLineMaterial(mesh.material, {
      isSelected,
      isHovered,
      isDraft,
      freedom,
    })
  }

  init = (args: CreateSegmentArgs) => {
    if (args.input.type !== 'Line') {
      return new Error('Invalid input type for PointSegment')
    }
    const { input, id } = args
    if (
      !(
        hasNumericValue(input.start.x) &&
        hasNumericValue(input.start.y) &&
        hasNumericValue(input.end.x) &&
        hasNumericValue(input.end.y)
      )
    ) {
      return new Error('Invalid position values for LineSegment')
    }
    const startX = input.start.x.value
    const startY = input.start.y.value
    const endX = input.end.x.value
    const endY = input.end.y.value
    const segmentGroup = new Group()
    const geometry = new LineGeometry()
    geometry.setPositions([startX, startY, 0, endX, endY, 0])
    const material = new LineMaterial({
      color: KCL_DEFAULT_COLOR,
      linewidth: SEGMENT_WIDTH_PX * window.devicePixelRatio,
    })
    const mesh = new Line2(geometry, material)

    mesh.userData.type = STRAIGHT_SEGMENT_BODY
    mesh.name = STRAIGHT_SEGMENT_BODY
    segmentGroup.name = id.toString()
    segmentGroup.userData = {
      type: SEGMENT_TYPE_LINE,
    }

    segmentGroup.add(mesh)

    // Store freedom in userData
    segmentGroup.userData.freedom = args.freedom ?? null

    this.update({
      input: input,
      theme: args.theme,
      id: id,
      scale: args.scale,
      group: segmentGroup,
      selectedIds: [],
      isDraft: args.isDraft,
      freedom: args.freedom,
    })

    return segmentGroup
  }
  update(args: UpdateSegmentArgs) {
    if (args.input.type !== 'Line') {
      return new Error('Invalid input type for PointSegment')
    }
    const { input, group, id, selectedIds, isDraft } = args
    if (
      !(
        hasNumericValue(input.start.x) &&
        hasNumericValue(input.start.y) &&
        hasNumericValue(input.end.x) &&
        hasNumericValue(input.end.y)
      )
    ) {
      return new Error('Invalid position values for LineSegment')
    }
    const straightSegmentBody = group.children.find(
      (child) => child.userData.type === STRAIGHT_SEGMENT_BODY
    )
    if (!(straightSegmentBody instanceof Line2)) {
      console.error('No straight segment body found in group')
      return
    }

    const geometry = straightSegmentBody.geometry
    geometry.setPositions([
      input.start.x.value,
      input.start.y.value,
      0,
      input.end.x.value,
      input.end.y.value,
      0,
    ])
    geometry.computeBoundingSphere()

    // Update mesh color based on selection
    const isSelected = selectedIds.includes(id)
    // Check if this segment is currently hovered (stored in userData)
    const isHovered = straightSegmentBody.userData.isHovered === true
    // Get freedom from args or group userData
    const freedom = args.freedom ?? group.userData.freedom ?? null
    // Update userData for consistency
    group.userData.freedom = freedom

    this.updateLineColors(
      straightSegmentBody,
      isSelected,
      isHovered,
      isDraft,
      freedom
    )
  }
}

class ArcSegment implements SketchEntityUtils {
  /**
   * Validates and extracts arc data from input, calculating radius and angles.
   * Returns an error if validation fails, otherwise returns the calculated values.
   */
  private extractArcData(input: SegmentCtor):
    | Error
    | {
        centerX: number
        centerY: number
        startX: number
        startY: number
        endX: number
        endY: number
        radius: number
        startAngle: number
        endAngle: number
      } {
    if (input.type !== 'Arc') {
      return new Error('Invalid input type for ArcSegment')
    }

    if (
      !(
        hasNumericValue(input.center.x) &&
        hasNumericValue(input.center.y) &&
        hasNumericValue(input.start.x) &&
        hasNumericValue(input.start.y) &&
        hasNumericValue(input.end.x) &&
        hasNumericValue(input.end.y)
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
    const radiusStart = Math.hypot(dxStart, dyStart)

    const dxEnd = endX - centerX
    const dyEnd = endY - centerY
    const radiusEnd = Math.hypot(dxEnd, dyEnd)

    // Use average radius in case of small floating point differences
    const radius = (radiusStart + radiusEnd) / 2

    // Calculate angles
    const startAngle = Math.atan2(startY - centerY, startX - centerX)
    const endAngle = Math.atan2(endY - centerY, endX - centerX)

    return {
      centerX,
      centerY,
      startX,
      startY,
      endX,
      endY,
      radius,
      startAngle,
      endAngle,
    }
  }

  /**
   * Updates the arc segment mesh color based on selection and hover state
   */
  updateArcColors(
    mesh: Line2,
    isSelected: boolean,
    isHovered: boolean,
    isDraft?: boolean,
    freedom?: Freedom | null
  ): void {
    updateLineMaterial(mesh.material, {
      isSelected,
      isHovered,
      isDraft,
      freedom,
    })
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
    const { input, id } = args
    // arcData is not actually used anymore in init because geometry is only constructed in update,
    // but we still check if it's an Error.
    const arcData = this.extractArcData(input)
    if (arcData instanceof Error) {
      return arcData
    }

    const segmentGroup = new Group()
    const geometry = new LineGeometry()
    const material = new LineMaterial({
      color: KCL_DEFAULT_COLOR,
      linewidth: SEGMENT_WIDTH_PX * window.devicePixelRatio,
    })
    const mesh = new Line2(geometry, material)

    mesh.userData.type = ARC_SEGMENT_BODY
    mesh.name = ARC_SEGMENT_BODY
    segmentGroup.name = id.toString()
    segmentGroup.userData = {
      type: SEGMENT_TYPE_ARC,
    }

    segmentGroup.add(mesh)

    // Store freedom in userData
    segmentGroup.userData.freedom = args.freedom ?? null

    this.update({
      input: input,
      theme: args.theme,
      id: id,
      scale: args.scale,
      group: segmentGroup,
      selectedIds: [],
      isDraft: args.isDraft,
      freedom: args.freedom,
    })

    return segmentGroup
  }

  update(args: UpdateSegmentArgs) {
    const { input, group, id, selectedIds, isDraft } = args
    const arcData = this.extractArcData(input)
    if (arcData instanceof Error) {
      return arcData
    }

    const { centerX, centerY, radius, startAngle, endAngle } = arcData

    const arcSegmentBody = group.children.find(
      (child) => child.userData.type === ARC_SEGMENT_BODY
    )
    if (!(arcSegmentBody instanceof Line2)) {
      console.error('No arc segment body found in group')
      return
    }

    // Always draw arcs CCW from start to end.
    // The solver also uses a CCW convention from start to end, so we keep
    // the angles as-is and force ccw = true to match that behaviour.
    const ccw = true
    arcSegmentBody.geometry.setPositions(
      createArcPositions({
        center: [centerX, centerY],
        radius,
        startAngle,
        endAngle,
        ccw,
      })
    )
    arcSegmentBody.geometry.computeBoundingSphere()
    arcSegmentBody.material.linewidth =
      SEGMENT_WIDTH_PX * window.devicePixelRatio

    // Update mesh color based on selection
    const isSelected = selectedIds.includes(id)
    // Check if this segment is currently hovered (stored in userData)
    const isHovered = arcSegmentBody.userData.isHovered === true
    // Get freedom from args or group userData
    const freedom = args.freedom ?? group.userData.freedom ?? null
    // Update userData for consistency
    group.userData.freedom = freedom

    this.updateArcColors(
      arcSegmentBody,
      isSelected,
      isHovered,
      isDraft,
      freedom
    )
  }
}

function updateLineMaterial(
  material: LineMaterial,
  {
    isSelected,
    isHovered,
    isDraft,
    freedom,
  }: {
    isSelected: boolean
    isHovered: boolean
    isDraft?: boolean
    freedom?: Freedom | null
  }
) {
  if (!material) return

  const color = getSegmentColor({
    isDraft,
    isHovered,
    isSelected,
    freedom,
  })
  material.color.set(color)
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
  const freedom = group.userData.freedom ?? null

  // Dispatch based on segment body type
  if (mesh.userData.type === STRAIGHT_SEGMENT_BODY) {
    if (mesh instanceof Line2) {
      segmentUtilsMap.LineSegment.updateLineColors(
        mesh,
        isSelected,
        isHovered,
        isDraft,
        freedom
      )
    } else {
      console.error('Straight segment body is not a Line2 anymore', mesh)
    }
  } else if (mesh.userData.type === ARC_SEGMENT_BODY) {
    if (mesh instanceof Line2) {
      segmentUtilsMap.ArcSegment.updateArcColors(
        mesh,
        isSelected,
        isHovered,
        isDraft,
        freedom
      )
    } else {
      console.error('Straight segment body is not a Line2 anymore', mesh)
    }
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

/**
 * Similar to src/clientSideScene/segments.ts / createArcGeometry, but:
 * - uses LineGeometry which supports screen space line thickness
 * - isDashed parameter not supported (yet)
 */
function createArcPositions({
  center,
  radius,
  startAngle,
  endAngle,
  ccw,
}: {
  center: [number, number]
  radius: number
  startAngle: number
  endAngle: number
  ccw: boolean
}): number[] {
  const arcStart = new EllipseCurve(
    center[0],
    center[1],
    radius,
    radius,
    startAngle,
    endAngle,
    !ccw,
    0
  )

  // Adaptive segmentation: use 100 for a full circle and proportionally less based on the arc length
  // This doesn't work unfortunately without recreating the geometry and at that point it's not worth it:
  // https://discourse.threejs.org/t/adding-points-drawcount-for-line2-dynamically/48980/4
  //
  // const angleDiff = getAngleDiff(startAngle, endAngle, ccw)
  // const numberOfPoints = Math.ceil(100 * (angleDiff / (Math.PI * 2)))

  const numberOfPoints = 100

  const points = arcStart.getPoints(numberOfPoints)
  const positions: number[] = []
  points.forEach((p) => {
    positions.push(p.x, p.y, 0)
  })

  return positions
}
