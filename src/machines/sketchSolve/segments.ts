import type { SegmentCtor } from '@rust/kcl-lib/bindings/FrontendApi'
import { SKETCH_POINT_HANDLE } from '@src/clientSideScene/sceneUtils'
import { type Themes } from '@src/lib/theme'
import {
  ExtrudeGeometry,
  Group,
  LineCurve3,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { createLineShape } from '@src/clientSideScene/segments'
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

interface CreateSegmentArgs {
  input: SegmentCtor
  theme: Themes
  id: number
  scale: number
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
  init: (args: CreateSegmentArgs) => Group | Error
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
    status: {
      isSelected: boolean
      isHovered: boolean
    }
  ): void {
    if (status.isHovered) {
      // Calculate darker version of SKETCH_SELECTION_COLOR (70% brightness)
      const darkerSelectionRgb = SKETCH_SELECTION_RGB.map((val) =>
        Math.round(val * 0.7)
      )
      const darkerSelectionRgbStr = darkerSelectionRgb.join(', ')
      innerCircle.style.backgroundColor = `rgb(${darkerSelectionRgbStr})`
      innerCircle.style.border = `1px solid rgba(${darkerSelectionRgbStr}, 0.5)`
      return // Hover styles take precedence
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
      this.updatePointColors(innerCircle, { isSelected, isHovered: true })
    })

    handleDiv.addEventListener('mouseleave', () => {
      const isHovered = false
      this.updatePointSize(innerCircle, isHovered)
      // Restore colors based on selection state stored in data attribute
      const isSelected = handleDiv.dataset.isSelected === 'true'
      this.updatePointColors(innerCircle, { isSelected, isHovered })
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
    })
    return segmentGroup
  }

  update(args: UpdateSegmentArgs) {
    if (args.input.type !== 'Point') {
      return new Error('Invalid input type for PointSegment')
    }
    const { input, group, scale, selectedIds, id } = args
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

      // Only update colors if not hovering (hover styles take precedence)
      if (!el.matches(':hover')) {
        this.updatePointColors(innerCircle, { isSelected, isHovered: false })
      }
    }
  }
}

class LineSegment implements SegmentUtils {
  /**
   * Updates the line segment mesh color based on selection and hover state
   */
  updateLineColors(mesh: Mesh, isSelected: boolean, isHovered: boolean): void {
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
    })

    return segmentGroup
  }
  update(args: UpdateSegmentArgs) {
    if (args.input.type !== 'Line') {
      return new Error('Invalid input type for PointSegment')
    }
    const { input, group, id, scale, selectedIds } = args
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
