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
import type { Vector2 } from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { sceneInfra, rustContext } from '@src/lib/singletons'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { roundOff } from '@src/lib/utils'
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

    // Store references for drag handling
    let isDragging = false
    let isEditInProgress = false
    let latestTwoD: Vector2 | null = null
    let lastAppliedTwoD: Vector2 | null = null

    // Convert screen coordinates to 2D sketch coordinates
    const screenTo2D = (event: MouseEvent): Vector2 | null => {
      // Update sceneInfra's current mouse vector (similar to updateCurrentMouseVector)
      const target = sceneInfra.renderer.domElement
      const rect = target.getBoundingClientRect()
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      // Temporarily set the mouse vector so getPlaneIntersectPoint works
      // We're bypassing the normal mouse flow, so we need to set it manually
      const originalVector = sceneInfra.currentMouseVector.clone()
      sceneInfra.currentMouseVector.set(x, y)

      const planeIntersect = sceneInfra.getPlaneIntersectPoint()

      // Restore original vector
      sceneInfra.currentMouseVector.copy(originalVector)

      return planeIntersect?.twoD || null
    }

    // Apply edit segment for a given 2D position
    const applyEditSegment = async (twoD: Vector2) => {
      if (!twoD) return

      isEditInProgress = true
      lastAppliedTwoD = twoD.clone()

      try {
        const settings = await jsAppSettings()
        const result = await rustContext.editSegments(
          0,
          0,
          [
            {
              id: args.id,
              ctor: {
                type: 'Point',
                position: {
                  x: { type: 'Var', value: roundOff(twoD.x), units: 'Mm' },
                  y: { type: 'Var', value: roundOff(twoD.y), units: 'Mm' },
                },
              },
            },
          ],
          settings
        )

        // Call the callback to notify sketchSolveMode
        if (result && args.onUpdateSketchOutcome) {
          args.onUpdateSketchOutcome(result)
        }

        // After edit completes, check if there's a newer position that needs to be applied
        if (
          latestTwoD &&
          (!lastAppliedTwoD ||
            latestTwoD.x !== lastAppliedTwoD.x ||
            latestTwoD.y !== lastAppliedTwoD.y)
        ) {
          // There's a newer position, apply it one more time
          await applyEditSegment(latestTwoD)
        }
      } catch (err) {
        console.error('failed to edit segment', err)
      } finally {
        isEditInProgress = false
      }
    }

    // Handle drag move
    const handleMouseMove = (event: MouseEvent) => {
      if (!isDragging) return

      const twoD = screenTo2D(event)
      if (!twoD) return

      // Always update the latest position, even if edit is in progress
      latestTwoD = twoD.clone()

      // Only start a new edit if one isn't already in progress
      if (!isEditInProgress) {
        void applyEditSegment(twoD)
      }
    }

    // Handle drag end
    const handleMouseUp = () => {
      if (isDragging) {
        isDragging = false
        innerCircle.style.opacity = '1'
        // Clear position state
        latestTwoD = null
        lastAppliedTwoD = null
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }

    // Set up mouse down handler to start drag
    handleDiv.onmousedown = (event: MouseEvent) => {
      if (event.button !== 0) return // Only handle left mouse button
      event.stopPropagation()
      event.preventDefault()
      isDragging = true
      innerCircle.style.opacity = '0.7'
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

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
    straightSegmentBody.material.color.set(
      isSelected ? SKETCH_SELECTION_COLOR : KCL_DEFAULT_COLOR
    )
  }
}

export const segmentUtilsMap = {
  PointSegment: new PointSegment(),
  LineSegment: new LineSegment(),
}
