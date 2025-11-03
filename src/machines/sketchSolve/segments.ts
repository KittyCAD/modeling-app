import type {
  Freedom,
  SceneGraphDelta,
  SketchExecOutcome,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import {
  SKETCH_LAYER,
  SKETCH_POINT_HANDLE,
} from '@src/clientSideScene/sceneUtils'
import { type Themes } from '@src/lib/theme'
import { Group } from 'three'
import type { Vector2 } from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { sceneInfra, rustContext } from '@src/lib/singletons'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { roundOff } from '@src/lib/utils'

type SegmentInputs = {
  type: 'point'
  position: [number, number]
  freedom: Freedom
}

interface CreateSegmentArgs {
  input: SegmentInputs
  theme: Themes
  id: number
  scale: number
  onUpdateSketchOutcome?: (data: {
    kclSource: SourceDelta
    sketchExecOutcome: SketchExecOutcome
    sceneGraphDelta: SceneGraphDelta
  }) => void
}

interface UpdateSegmentArgs {
  input: SegmentInputs
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
  init: (args: CreateSegmentArgs) => any
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
  init = async (args: CreateSegmentArgs) => {
    if (args.input.type !== 'point') {
      return Promise.reject(new Error('Invalid input type for PointSegment'))
    }
    const segmentGroup = new Group()

    // const box = new BoxGeometry(12, 12, 12)
    // const body = new MeshBasicMaterial({ color: 0xffffff, depthTest: false })
    // const mesh = new Mesh(box, body)
    // mesh.userData.type = 'handle'
    // mesh.name = 'handle'

    // Create a 2D box using CSS2DObject
    const handleDiv = document.createElement('div')
    handleDiv.dataset.segment_id = String(args.id)
    handleDiv.dataset.handle = SKETCH_POINT_HANDLE
    handleDiv.style.width = '12px'
    handleDiv.style.height = '12px'
    handleDiv.style.backgroundColor = '#ffffff'
    handleDiv.style.border = '1px solid #cccccc'
    handleDiv.style.borderRadius = '50%'
    handleDiv.style.position = 'absolute'
    handleDiv.style.pointerEvents = 'auto'
    handleDiv.style.cursor = 'move'
    handleDiv.style.transform = 'translate(-50%, -50%)'

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
        const result = await rustContext.editSegment(
          0,
          0,
          args.id,
          {
            type: 'Point',
            position: {
              x: { type: 'Var', value: roundOff(twoD.x), units: 'Mm' },
              y: { type: 'Var', value: roundOff(twoD.y), units: 'Mm' },
            },
          },
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
        handleDiv.style.opacity = '1'
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
      handleDiv.style.opacity = '0.7'
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    const cssObject = new CSS2DObject(handleDiv)
    cssObject.userData.type = 'handle'
    cssObject.name = 'handle'
    // Store reference to the group on the CSS2DObject for potential future use
    cssObject.userData.group = segmentGroup

    segmentGroup.name = args.id.toString()
    segmentGroup.userData = {
      type: 'point',
    }
    segmentGroup.add(cssObject)
    segmentGroup.traverse((child) => {
      child.layers.set(SKETCH_LAYER)
    })
    cssObject.layers.set(SKETCH_LAYER)

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
    if (args.input.type !== 'point') {
      return Promise.reject(new Error('Invalid input type for PointSegment'))
    }
    const [x, y] = args.input.position
    args.group.scale.set(args.scale, args.scale, args.scale)
    const handle = args.group.getObjectByName('handle')
    if (handle && handle instanceof CSS2DObject) {
      handle.position.set(x / args.scale, y / args.scale, 0)

      // Update selected styling based on whether this segment id is selected
      const el = handle.element
      const isSelected = args.selectedIds.includes(args.id)
      // TODO don't have these hardcoded here
      el.style.backgroundColor = isSelected ? '#FFB727' : '#3C73FF'
      el.style.border = '1px solid #CCCCCC'
    }
  }
}

export const segmentUtilsMap = {
  PointSegment: new PointSegment(),
}
