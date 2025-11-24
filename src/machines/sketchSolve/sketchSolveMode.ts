import {
  assertEvent,
  assign,
  createMachine,
  sendParent,
  sendTo,
  setup,
} from 'xstate'
import type { ActorRefFrom } from 'xstate'
import type { SetSelections } from '@src/machines/modelingSharedTypes'
import { machine as centerRectTool } from '@src/machines/sketchSolve/tools/centerRectTool'
import { machine as dimensionTool } from '@src/machines/sketchSolve/tools/dimensionTool'
import { machine as pointTool } from '@src/machines/sketchSolve/tools/pointTool'
import { machine as lineTool } from '@src/machines/sketchSolve/tools/lineTool'
import type {
  ApiObject,
  ExistingSegmentCtor,
  Expr,
  SceneGraphDelta,
  SegmentCtor,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type CodeManager from '@src/lang/codeManager'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { SceneEntities } from '@src/clientSideScene/sceneEntities'
import type RustContext from '@src/lib/rustContext'
import type { KclManager } from '@src/lang/KclSingleton'
import {
  SEGMENT_TYPE_LINE,
  SEGMENT_TYPE_POINT,
  type SegmentUtils,
  segmentUtilsMap,
  updateLineSegmentHover,
  htmlHelper,
} from '@src/machines/sketchSolve/segments'
import type { Object3D } from 'three'
import {
  Box3,
  ExtrudeGeometry,
  Group,
  Mesh,
  OrthographicCamera,
  Vector2,
  Vector3,
} from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { orthoScale, perspScale } from '@src/clientSideScene/helpers'
import {
  getParentGroup,
  STRAIGHT_SEGMENT_BODY,
} from '@src/clientSideScene/sceneConstants'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { roundOff } from '@src/lib/utils'
import type {
  DefaultPlane,
  ExtrudeFacePlane,
  OffsetPlane,
} from '@src/machines/modelingSharedTypes'
import {
  SKETCH_LAYER,
  SKETCH_SOLVE_GROUP,
} from '@src/clientSideScene/sceneUtils'
import type { Themes } from '@src/lib/theme'
import { disposeGroupChildren } from '@src/clientSideScene/sceneHelpers'
import { forceSuffix } from '@src/lang/util'
import {
  baseUnitToNumericSuffix,
  distanceBetweenPoint2DExpr,
  type NumericSuffix,
} from '@src/lang/wasm'

const equipTools = Object.freeze({
  centerRectTool,
  dimensionTool,
  pointTool,
  lineTool,
})

const CHILD_TOOL_ID = 'child tool'
const CHILD_TOOL_DONE_EVENT = `xstate.done.actor.${CHILD_TOOL_ID}`

/**
 * Helper function to build a segment ctor from a scene graph object.
 * Returns null if the object is not a segment or if required data is missing.
 */
function buildSegmentCtorFromObject(
  obj: ApiObject,
  objects: Array<ApiObject>
): Parameters<SegmentUtils['update']>[0]['input'] | null {
  if (obj.kind.type === 'Segment' && obj.kind.segment.type === 'Point') {
    return {
      type: 'Point',
      position: {
        x: {
          type: 'Number',
          value: obj.kind.segment.position.x.value,
          units: obj.kind.segment.position.x.units,
        },
        y: {
          type: 'Number',
          value: obj.kind.segment.position.y.value,
          units: obj.kind.segment.position.y.units,
        },
      },
    }
  } else if (
    obj?.kind?.type === 'Segment' &&
    obj.kind?.segment?.type === 'Line'
  ) {
    const startPoint = getLinkedPoint({
      objects,
      pointId: obj.kind.segment.start,
    })
    const endPoint = getLinkedPoint({
      objects,
      pointId: obj.kind.segment.end,
    })
    if (!startPoint || !endPoint) {
      console.error('Failed to find linked points for Line segment', obj)
      return null
    }
    return {
      type: 'Line',
      start: startPoint,
      end: endPoint,
    }
  }
  return null
}

/**
 * Helper function to update a segment group with the given input and selection state.
 * Determines the correct segment update method based on the input type.
 */
function updateSegmentGroup({
  group,
  input,
  selectedIds,
  scale,
  theme,
}: {
  group: Group
  input: Parameters<SegmentUtils['update']>[0]['input']
  selectedIds: Array<number>
  scale: number
  theme: Themes
}): void {
  const idNum = Number(group.name)
  if (Number.isNaN(idNum)) {
    return
  }

  if (input.type === 'Point') {
    void segmentUtilsMap.PointSegment.update({
      input,
      theme,
      scale,
      id: idNum,
      group,
      selectedIds,
    })
  } else if (input.type === 'Line') {
    void segmentUtilsMap.LineSegment.update({
      input,
      theme,
      scale,
      id: idNum,
      group,
      selectedIds,
    })
  }
}

/**
 * Helper function to initialize a segment group with the given input.
 * Determines the correct segment init method based on the input type.
 */
function initSegmentGroup({
  input,
  theme,
  scale,
  id,
  onUpdateSketchOutcome,
}: {
  input: Parameters<SegmentUtils['init']>[0]['input']
  theme: Themes
  scale: number
  id: number
  onUpdateSketchOutcome: (data: {
    kclSource: SourceDelta
    sceneGraphDelta: SceneGraphDelta
  }) => void
}): Promise<Group> {
  if (input.type === 'Point') {
    return segmentUtilsMap.PointSegment.init({
      input,
      theme,
      scale,
      id,
      onUpdateSketchOutcome,
    })
  } else if (input.type === 'Line') {
    return segmentUtilsMap.LineSegment.init({
      input,
      theme,
      scale,
      id,
      onUpdateSketchOutcome,
    })
  }
  return Promise.reject(new Error(`Unknown input type: ${(input as any).type}`))
}

function getLinkedPoint({
  pointId,
  objects,
}: {
  pointId: number
  objects: Array<ApiObject>
}): { x: Expr; y: Expr } | null {
  const point = objects[pointId]
  if (
    point?.kind?.type !== 'Segment' ||
    point?.kind?.segment?.type !== 'Point'
  ) {
    return null
  }
  return {
    x: {
      type: 'Var',
      value: point.kind.segment.position.x.value,
      units: point.kind.segment.position.x.units,
    },
    y: {
      type: 'Var',
      value: point.kind.segment.position.y.value,
      units: point.kind.segment.position.y.units,
    },
  }
}

/**
 * Helper function to extract numeric value from an Expr.
 * Returns the value and units, or null if the Expr doesn't contain a numeric value.
 */
function extractNumericValue(
  expr: Expr
): { value: number; units: string } | null {
  if (expr.type === 'Number' || expr.type === 'Var') {
    return {
      value: expr.value,
      units: expr.units,
    }
  }
  return null
}

/**
 * Helper function to apply a drag vector to a Point2D Expr.
 * Returns a new Expr with the vector applied.
 */
function applyVectorToPoint2D(
  point: { x: Expr; y: Expr },
  vector: Vector2
): { x: Expr; y: Expr } {
  const xValue = extractNumericValue(point.x)
  const yValue = extractNumericValue(point.y)

  if (!xValue || !yValue) {
    // If we can't extract values, return original
    return point
  }

  return {
    x: {
      type: 'Var',
      value: roundOff(xValue.value + vector.x),
      units: forceSuffix(xValue.units),
    },
    y: {
      type: 'Var',
      value: roundOff(yValue.value + vector.y),
      units: forceSuffix(yValue.units),
    },
  }
}

/**
 * Helper function to build a segment ctor with drag applied.
 * For the entity under cursor, uses twoD directly.
 * For other entities, applies twoDVec to their current positions.
 */
function buildSegmentCtorWithDrag({
  objUnderCursor: obj,
  selectedObjects: objects,
  isEntityUnderCursor,
  currentCursorPosition,
  dragVec,
  units,
}: {
  objUnderCursor: ApiObject
  selectedObjects: Array<ApiObject>
  isEntityUnderCursor: boolean
  currentCursorPosition: Vector2
  dragVec: Vector2
  units: NumericSuffix
}): SegmentCtor | null {
  const baseCtor = buildSegmentCtorFromObject(obj, objects)
  if (!baseCtor) {
    return null
  }

  if (baseCtor.type === 'Point') {
    if (isEntityUnderCursor) {
      // Use twoD directly for entity under cursor
      // Note: currentCursorPosition comes from intersectionPoint.twoD which is in world coordinates and scaled to match current units
      return {
        type: 'Point',
        position: {
          x: {
            type: 'Var',
            value: roundOff(currentCursorPosition.x),
            units,
          },
          y: {
            type: 'Var',
            value: roundOff(currentCursorPosition.y),
            units,
          },
        },
      }
    } else {
      // Apply drag vector to current position
      const currentPos = {
        x: baseCtor.position.x,
        y: baseCtor.position.y,
      }
      const newPos = applyVectorToPoint2D(currentPos, dragVec)
      return {
        type: 'Point',
        position: newPos,
      }
    }
  } else if (baseCtor.type === 'Line') {
    // For lines, always apply the drag vector to both endpoints (translate the line)
    // This applies whether it's the entity under cursor or another selected entity
    const newStart = applyVectorToPoint2D(baseCtor.start, dragVec)
    const newEnd = applyVectorToPoint2D(baseCtor.end, dragVec)
    return {
      type: 'Line',
      start: newStart,
      end: newEnd,
    }
  }

  return baseCtor
}

export type EquipTool = keyof typeof equipTools

// Type for the spawn function used in XState setup actions
// This provides better type safety by constraining the actor parameter to valid tool names
// and ensuring the return type matches the specific tool actor
type SpawnToolActor = <K extends EquipTool>(
  src: K,
  options?: {
    id?: string
    input?: {
      sceneInfra: SceneInfra
      rustContext: RustContext
      kclManager: KclManager
      sketchId: number
    }
  }
) => ActorRefFrom<(typeof equipTools)[K]>

export type SketchSolveMachineEvent =
  | { type: 'exit' }
  | { type: 'update selection'; data?: SetSelections }
  | { type: 'unequip tool' }
  | { type: 'equip tool'; data: { tool: EquipTool } }
  | {
      type:
        | 'coincident'
        | 'LinesEqualLength'
        | 'Vertical'
        | 'Horizontal'
        | 'Parallel'
        | 'Distance'
    }
  | {
      type: 'update selected ids'
      data: { selectedIds?: Array<number>; duringAreaSelectIds?: Array<number> }
    }
  | { type: typeof CHILD_TOOL_DONE_EVENT }
  | {
      type: 'update sketch outcome'
      data: {
        kclSource: SourceDelta
        sceneGraphDelta: SceneGraphDelta
      }
    }
  | { type: 'delete selected' }

type SketchSolveContext = {
  sketchSolveToolName: EquipTool | null
  pendingToolName?: EquipTool
  selectedIds: Array<number>
  duringAreaSelectIds: Array<number>
  sketchExecOutcome?: {
    kclSource: SourceDelta
    sceneGraphDelta: SceneGraphDelta
  }
  initialPlane?: DefaultPlane | OffsetPlane | ExtrudeFacePlane
  sketchId: number
  // Dependencies passed from parent
  codeManager: CodeManager
  sceneInfra: SceneInfra
  sceneEntitiesManager: SceneEntities
  rustContext: RustContext
  kclManager: KclManager
}

export const sketchSolveMachine = setup({
  types: {
    context: {} as SketchSolveContext,
    events: {} as SketchSolveMachineEvent,
    input: {} as {
      initialSketchSolvePlane?:
        | DefaultPlane
        | OffsetPlane
        | ExtrudeFacePlane
        | null
      sketchId: number
      codeManager: CodeManager
      sceneInfra: SceneInfra
      sceneEntitiesManager: SceneEntities
      rustContext: RustContext
      kclManager: KclManager
    },
  },
  actions: {
    'initialize intersection plane': ({ context }) => {
      if (context.initialPlane) {
        context.sceneEntitiesManager.initSketchSolveEntityOrientation(
          context.initialPlane
        )
      }
    },
    setUpOnDragAndSelectionClickCallbacks: ({ self, context }) => {
      // Closure-scoped mutex to prevent concurrent async editSegment operations.
      // Not in XState context since it's purely an implementation detail for race condition prevention.
      let isSolveInProgress = false
      let lastHoveredMesh: Mesh | null = null
      let lastSuccessfulDragFromPoint = new Vector2()
      let draggingPointElement: HTMLElement | null = null

      /**
       * Helper function to find the CSS2DObject element for visual feedback
       * Used to update opacity during drag
       */
      function findPointSegmentElement(segmentId: number): HTMLElement | null {
        // Find the element with the matching segment_id
        const allElements = document.querySelectorAll('[data-segment_id]')
        for (const el of allElements) {
          if (
            el instanceof HTMLElement &&
            el.dataset.segment_id === String(segmentId)
          ) {
            return el
          }
        }
        return null
      }

      // Selection box visual element
      let selectionBoxObject: CSS2DObject | null = null
      let selectionBoxGroup: Group | null = null
      let labelsWrapper: HTMLElement | null = null
      let boxDiv: HTMLElement | null = null
      let verticalLine: HTMLElement | null = null
      let horizontalLine: HTMLElement | null = null

      /**
       * Helper function to create or update the selection box visual
       * Uses 3D coordinates and projects to screen space for accurate sizing
       */
      function updateSelectionBox(
        startPoint3D: Vector3,
        currentPoint3D: Vector3
      ): void {
        const camera = context.sceneInfra.camControls.camera
        const renderer = context.sceneInfra.renderer

        // Project 3D coordinates to screen space (NDC)
        const startScreen = startPoint3D.clone().project(camera)
        const currentScreen = currentPoint3D.clone().project(camera)

        // Convert NDC to screen pixels
        // Use client size (CSS pixels) not drawing buffer size (device pixels)
        const viewportSize = new Vector2(
          renderer.domElement.clientWidth,
          renderer.domElement.clientHeight
        )
        const startPx = new Vector2(
          ((startScreen.x + 1) / 2) * viewportSize.x,
          ((1 - startScreen.y) / 2) * viewportSize.y
        )
        const currentPx = new Vector2(
          ((currentScreen.x + 1) / 2) * viewportSize.x,
          ((1 - currentScreen.y) / 2) * viewportSize.y
        )

        // Calculate box dimensions in screen pixels
        const boxMinPx = new Vector2(
          Math.min(startPx.x, currentPx.x),
          Math.min(startPx.y, currentPx.y)
        )
        const boxMaxPx = new Vector2(
          Math.max(startPx.x, currentPx.x),
          Math.max(startPx.y, currentPx.y)
        )

        const widthPx = boxMaxPx.x - boxMinPx.x
        const heightPx = boxMaxPx.y - boxMinPx.y

        // Determine selection direction:
        // - L to R (dashed intersection box)
        // - R to L (solid contains box)
        const isIntersectionBox = startPx.x > currentPx.x
        const isDraggingUpward = startPx.y > currentPx.y
        const borderStyle = isIntersectionBox ? 'dashed' : 'solid'

        // Calculate center in 3D world space
        const center3D = new Vector3()
          .addVectors(startPoint3D, currentPoint3D)
          .multiplyScalar(0.5)

        // Get the sketch solve group to transform coordinates to its local space
        const sketchSceneGroup =
          context.sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)

        if (!selectionBoxGroup) {
          // Create the selection box group and CSS2DObject
          selectionBoxGroup = new Group()
          selectionBoxGroup.name = 'selectionBox'
          selectionBoxGroup.userData.type = 'selectionBox'

          // TODO configure to work with light mode too
          ;[boxDiv, verticalLine, horizontalLine, labelsWrapper] = htmlHelper`
            <div
              ${{ key: 'id', value: 'selection-box' }}
              style="
                position: absolute;
                pointer-events: none;
                border: 2px ${borderStyle} rgba(255, 255, 255, 0.5);
                background-color: rgba(255, 255, 255, 0.1);
                transform: translate(-50%, -50%);
                box-sizing: border-box;
              "
            >
              <div
                ${{ key: 'id', value: 'vertical-line' }}
                style="
                  position: absolute;
                  pointer-events: none;
                  background-color: rgba(255, 255, 255, 0.5);
                  width: 2px;
                "
              ></div>
              <div
                ${{ key: 'id', value: 'horizontal-line' }}
                style="
                  position: absolute;
                  pointer-events: none;
                  background-color: rgba(255, 255, 255, 0.5);
                  height: 2px;
                "
              ></div>
              <div
                ${{ key: 'id', value: 'labels-wrapper' }}
                style="
                  position: absolute;
                  pointer-events: none;
                  white-space: nowrap;
                  display: flex;
                  gap: 0px;
                  align-items: center;
                "
              >
                <div
                  ${{ key: 'id', value: 'intersects-label' }}
                  style="
                    font-size: 11px;
                    color: rgba(255, 255, 255, 0.7);
                    user-select: none;
                    width: 100px;
                    padding: 6px;
                    margin: 0px;
                    text-align: right;
                  "
                >Intersects</div>
                <div
                  ${{ key: 'id', value: 'contains-label' }}
                  style="
                    font-size: 11px;
                    color: rgba(255, 255, 255, 0.7);
                    user-select: none;
                    width: 100px;
                    padding: 6px;
                    margin: 0px;
                  "
                >Within</div>
              </div>
            </div>
          `

          labelsWrapper

          selectionBoxObject = new CSS2DObject(boxDiv)
          selectionBoxObject.userData.type = 'selectionBox'
          selectionBoxGroup.add(selectionBoxObject)

          // Add to sketch solve group (will inherit its rotation)
          if (sketchSceneGroup) {
            sketchSceneGroup.add(selectionBoxGroup)
            selectionBoxGroup.layers.set(SKETCH_LAYER)
            selectionBoxObject.layers.set(SKETCH_LAYER)
          }
        }

        if (
          selectionBoxObject &&
          selectionBoxObject.element instanceof HTMLElement
        ) {
          // Transform center position to sketch solve group's local space
          // Since the selection box group is a child of the rotated sketch solve group,
          // we need to position the CSS2DObject in the sketch solve group's local space
          const localCenter = new Vector3()
          if (sketchSceneGroup) {
            // Transform world position to local space of sketch solve group
            sketchSceneGroup.worldToLocal(localCenter.copy(center3D))
          } else {
            localCenter.copy(center3D)
          }
          selectionBoxObject.position.copy(localCenter)

          // Size in CSS pixels (already calculated from screen projection)
          const boxDiv = selectionBoxObject.element
          boxDiv.style.width = `${widthPx}px`
          boxDiv.style.height = `${heightPx}px`

          // Update border style based on selection direction
          boxDiv.style.border = `2px ${borderStyle} rgba(255, 255, 255, 0.5)`

          // Update label opacity based on active selection mode
          if (labelsWrapper) {
            const intersectsLabel = labelsWrapper.children[0] as HTMLElement
            const containsLabel = labelsWrapper.children[1] as HTMLElement

            if (intersectsLabel && containsLabel) {
              if (isIntersectionBox) {
                // Intersection mode active - "Intersects" is full opacity, "Within" is lower contrast
                intersectsLabel.style.opacity = '1'
                containsLabel.style.opacity = '0.4'
                intersectsLabel.style.fontWeight = '600'
                containsLabel.style.fontWeight = '400'
              } else {
                // Contains mode active - "Within" is full opacity, "Intersects" is lower contrast
                intersectsLabel.style.opacity = '0.4'
                containsLabel.style.opacity = '1'
                intersectsLabel.style.fontWeight = '400'
                containsLabel.style.fontWeight = '600'
              }
            }
          }

          // Position labels at the drag start point
          // The boxDiv is centered with translate(-50%, -50%), so its top-left is at (-width/2, -height/2)
          // We need to position the labels at the start point relative to the boxDiv's coordinate system

          // Calculate box center in screen pixels
          const centerPx = new Vector2(
            (boxMinPx.x + boxMaxPx.x) / 2,
            (boxMinPx.y + boxMaxPx.y) / 2
          )

          // Calculate offset from box center to start point (in screen pixels)
          const offsetX = startPx.x - centerPx.x
          const offsetY = startPx.y - centerPx.y

          // Adjust vertical position based on drag direction
          // If dragging downward, labels should be above (negative offset)
          // If dragging upward, labels should be below (positive offset)
          const verticalOffset = isDraggingUpward ? 12 : -12 // spacing from box edge
          const finalOffsetY = offsetY + verticalOffset

          // Position corner lines and labels at the start point
          // Since boxDiv has transform: translate(-50%, -50%), its coordinate system
          // has the center at (0, 0), with top-left at (-width/2, -height/2)
          // So we position at (offsetX, finalOffsetY) and center the labels wrapper there

          // Calculate start point position relative to box center
          const startX = offsetX
          const startY = offsetY

          const lineExtensionSize = '12px'

          // Position vertical line (extends from start point to nearest vertical edge)
          if (verticalLine && verticalLine instanceof HTMLElement) {
            verticalLine.style.left = `calc(50% + ${startX}px)`
            verticalLine.style.top = `calc(50% + ${startY}px)`
            verticalLine.style.height = lineExtensionSize
            if (startY > 0) {
              // Start point is above center, line extends upward to top edge
              verticalLine.style.transform = 'translateX(-50%)'
            } else {
              // Start point is below center, line extends downward to bottom edge
              verticalLine.style.transform = 'translate(-50%, -100%)'
            }
          }

          // Position horizontal line (extends from start point to nearest horizontal edge)
          if (horizontalLine && horizontalLine instanceof HTMLElement) {
            horizontalLine.style.top = `calc(50% + ${startY}px)`
            horizontalLine.style.width = lineExtensionSize
            horizontalLine.style.left = `calc(50% + ${startX}px)`
            if (startX < 0) {
              // Start point is left of center, line extends leftward to left edge
              horizontalLine.style.transform = 'translate(-100%, -50%)'
            } else {
              // Start point is right of center, line extends rightward to right edge
              horizontalLine.style.transform = 'translateY(-50%)'
            }
          }

          if (labelsWrapper) {
            // Position relative to boxDiv center (which is at 50%, 50% in boxDiv's coordinate system)
            // Then add the offset to move to the start point
            labelsWrapper.style.left = `calc(50% + ${startX}px)`
            labelsWrapper.style.top = `calc(50% + ${finalOffsetY}px)`
            // Center the labels wrapper at this point so the middle of the two labels aligns with the corner
            labelsWrapper.style.transform = 'translate(-50%, -50%)'
          }
        }
      }

      /**
       * Helper function to remove the selection box visual
       */
      function removeSelectionBox(): void {
        if (selectionBoxGroup) {
          selectionBoxGroup.removeFromParent()
          if (selectionBoxObject?.element instanceof HTMLElement) {
            selectionBoxObject.element.remove()
          }
          selectionBoxGroup = null
          selectionBoxObject = null
          labelsWrapper = null
        }
      }

      /**
       * Helper function to check if a point segment (CSS2DObject) is within the selection box
       * Returns the segment ID if it should be included, null otherwise
       */
      function checkPointSegmentInBox(
        css2dObject: CSS2DObject,
        segmentId: number,
        objects: Array<any>,
        camera: any,
        renderer: any,
        boxMinPx: Vector2,
        boxMaxPx: Vector2
      ): number | null {
        // Handle point segment - check if it has an owner (line endpoint)
        const obj = objects[segmentId]
        if (
          obj?.kind?.type === 'Segment' &&
          obj.kind.segment.type === 'Point'
        ) {
          // Skip if point has an owner (it's a line endpoint)
          // Maybe we can enable these selection with a key modifier in the future
          if (
            obj.kind.segment.owner !== null &&
            obj.kind.segment.owner !== undefined
          ) {
            return null
          }

          // Get the world position of the CSS2DObject
          css2dObject.updateMatrixWorld()
          const worldPos = new Vector3()
          css2dObject.getWorldPosition(worldPos)

          // Project to screen space
          const viewportSize = new Vector2(
            renderer.domElement.clientWidth,
            renderer.domElement.clientHeight
          )
          const projected = worldPos.clone().project(camera)
          const screenPos = new Vector2(
            ((projected.x + 1) / 2) * viewportSize.x,
            ((1 - projected.y) / 2) * viewportSize.y
          )

          // Check if the point is within the selection box
          if (
            screenPos.x >= boxMinPx.x &&
            screenPos.x <= boxMaxPx.x &&
            screenPos.y >= boxMinPx.y &&
            screenPos.y <= boxMaxPx.y
          ) {
            return segmentId
          }
        }
        return null
      }

      /**
       * Helper function to find segments (line segments and point segments) contained within the selection box
       * Uses screen-space projection to check if segments are within the box
       */
      function findContainedSegments(
        boxMinPx: Vector2,
        boxMaxPx: Vector2
      ): Array<number> {
        const camera = context.sceneInfra.camControls.camera
        const renderer = context.sceneInfra.renderer
        const sketchSegments =
          context.sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
        if (!sketchSegments) {
          return []
        }

        // Get scene graph objects to check point ownership
        const snapshot = self.getSnapshot()
        const sceneGraphDelta =
          snapshot.context.sketchExecOutcome?.sceneGraphDelta
        const objects = sceneGraphDelta?.new_graph.objects
        if (!objects) {
          return []
        }

        const containedIds: Array<number> = []
        const viewportSize = new Vector2(
          renderer.domElement.clientWidth,
          renderer.domElement.clientHeight
        )

        // Traverse all groups in the sketch solve group
        sketchSegments.traverse((child: Object3D) => {
          if (!(child instanceof Group)) {
            return
          }

          const segmentId = Number(child.name)
          if (Number.isNaN(segmentId)) {
            return
          }

          // Check if this group has a line segment mesh
          const lineMesh = child.children.find(
            (c) =>
              c instanceof Mesh && c.userData?.type === STRAIGHT_SEGMENT_BODY
          )

          if (lineMesh && lineMesh instanceof Mesh) {
            // Handle line segment
            const geometry = lineMesh.geometry
            if (!(geometry instanceof ExtrudeGeometry)) {
              return
            }

            // Get the bounding box of the mesh in world space
            lineMesh.updateMatrixWorld()
            const box = new Box3().setFromObject(lineMesh)

            // Get the 8 corners of the bounding box
            const min = box.min
            const max = box.max

            // Generate all 8 corners of the bounding box (already in world space)
            const corners = [
              new Vector3(min.x, min.y, min.z),
              new Vector3(max.x, min.y, min.z),
              new Vector3(min.x, max.y, min.z),
              new Vector3(max.x, max.y, min.z),
              new Vector3(min.x, min.y, max.z),
              new Vector3(max.x, min.y, max.z),
              new Vector3(min.x, max.y, max.z),
              new Vector3(max.x, max.y, max.z),
            ]

            // Project to screen space
            const screenCorners = corners.map((corner) => {
              const projected = corner.clone().project(camera)
              return new Vector2(
                ((projected.x + 1) / 2) * viewportSize.x,
                ((1 - projected.y) / 2) * viewportSize.y
              )
            })

            // For "contains" selection, check if ALL corners are within the selection box
            const allCornersContained = screenCorners.every((corner) => {
              return (
                corner.x >= boxMinPx.x &&
                corner.x <= boxMaxPx.x &&
                corner.y >= boxMinPx.y &&
                corner.y <= boxMaxPx.y
              )
            })

            if (allCornersContained) {
              containedIds.push(segmentId)
            }
            return
          }

          // Check if this group has a CSS2DObject (point segment)
          const css2dObject = child.children.find(
            (c) => c instanceof CSS2DObject && c.userData?.type === 'handle'
          )

          if (css2dObject && css2dObject instanceof CSS2DObject) {
            const pointId = checkPointSegmentInBox(
              css2dObject,
              segmentId,
              objects,
              camera,
              renderer,
              boxMinPx,
              boxMaxPx
            )
            if (pointId !== null) {
              containedIds.push(pointId)
            }
          }
        })

        return containedIds
      }

      /**
       * Helper function to find segments (line segments and point segments) that intersect with the selection box
       * Uses screen-space projection to check if segments intersect the box
       */
      function findIntersectingSegments(
        boxMinPx: Vector2,
        boxMaxPx: Vector2
      ): Array<number> {
        const camera = context.sceneInfra.camControls.camera
        const renderer = context.sceneInfra.renderer
        const sketchSegments =
          context.sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
        if (!sketchSegments) {
          return []
        }

        // Get scene graph objects to check point ownership
        const snapshot = self.getSnapshot()
        const sceneGraphDelta =
          snapshot.context.sketchExecOutcome?.sceneGraphDelta
        const objects = sceneGraphDelta?.new_graph.objects
        if (!objects) {
          return []
        }

        const intersectingIds: Array<number> = []
        const viewportSize = new Vector2(
          renderer.domElement.clientWidth,
          renderer.domElement.clientHeight
        )

        // Traverse all groups in the sketch solve group
        sketchSegments.traverse((child: Object3D) => {
          if (!(child instanceof Group)) {
            return
          }

          const segmentId = Number(child.name)
          if (Number.isNaN(segmentId)) {
            return
          }

          // Check if this group has a line segment mesh
          const lineMesh = child.children.find(
            (c) =>
              c instanceof Mesh && c.userData?.type === STRAIGHT_SEGMENT_BODY
          )

          if (lineMesh && lineMesh instanceof Mesh) {
            // Handle line segment
            const geometry = lineMesh.geometry
            if (!(geometry instanceof ExtrudeGeometry)) {
              return
            }

            // Get the bounding box of the mesh in world space
            lineMesh.updateMatrixWorld()
            const box = new Box3().setFromObject(lineMesh)

            // Get the 8 corners of the bounding box
            const min = box.min
            const max = box.max

            // Generate all 8 corners of the bounding box (already in world space)
            const corners = [
              new Vector3(min.x, min.y, min.z),
              new Vector3(max.x, min.y, min.z),
              new Vector3(min.x, max.y, min.z),
              new Vector3(max.x, max.y, min.z),
              new Vector3(min.x, min.y, max.z),
              new Vector3(max.x, min.y, max.z),
              new Vector3(min.x, max.y, max.z),
              new Vector3(max.x, max.y, max.z),
            ]

            // Project to screen space
            const screenCorners = corners.map((corner) => {
              const projected = corner.clone().project(camera)
              return new Vector2(
                ((projected.x + 1) / 2) * viewportSize.x,
                ((1 - projected.y) / 2) * viewportSize.y
              )
            })

            // For "intersection" selection, check if the bounding box overlaps with the selection box
            // Compute the bounding box of the line segment in screen space
            const segmentMinPx = new Vector2(
              Math.min(...screenCorners.map((c) => c.x)),
              Math.min(...screenCorners.map((c) => c.y))
            )
            const segmentMaxPx = new Vector2(
              Math.max(...screenCorners.map((c) => c.x)),
              Math.max(...screenCorners.map((c) => c.y))
            )

            // Check if bounding boxes overlap (intersect)
            // Two axis-aligned boxes intersect if:
            // - segmentMinPx.x <= boxMaxPx.x AND segmentMaxPx.x >= boxMinPx.x AND
            // - segmentMinPx.y <= boxMaxPx.y AND segmentMaxPx.y >= boxMinPx.y
            const boxesIntersect =
              segmentMinPx.x <= boxMaxPx.x &&
              segmentMaxPx.x >= boxMinPx.x &&
              segmentMinPx.y <= boxMaxPx.y &&
              segmentMaxPx.y >= boxMinPx.y

            if (boxesIntersect) {
              intersectingIds.push(segmentId)
            }
            return
          }

          // Check if this group has a CSS2DObject (point segment)
          const css2dObject = child.children.find(
            (c) => c instanceof CSS2DObject && c.userData?.type === 'handle'
          )

          if (css2dObject && css2dObject instanceof CSS2DObject) {
            const pointId = checkPointSegmentInBox(
              css2dObject,
              segmentId,
              objects,
              camera,
              renderer,
              boxMinPx,
              boxMaxPx
            )
            if (pointId !== null) {
              intersectingIds.push(pointId)
            }
          }
        })

        return intersectingIds
      }

      context.sceneInfra.setCallbacks({
        onDragStart: ({ intersectionPoint, selected }) => {
          // reset on drag start
          lastSuccessfulDragFromPoint = intersectionPoint.twoD.clone()

          // Check if we're starting a drag on a point segment (CSS2DObject)
          // sceneInfra now sets selected to the parent Group for CSS2DObjects
          if (selected instanceof Group) {
            const segmentId = Number(selected.name)
            if (!Number.isNaN(segmentId)) {
              // Check if this is a point segment by looking for the CSS2DObject
              const hasCSS2DObject = selected.children.some(
                (child) => child.userData?.type === 'handle'
              )
              if (hasCSS2DObject) {
                draggingPointElement = findPointSegmentElement(segmentId)
                // Set opacity to indicate dragging
                if (draggingPointElement) {
                  const innerCircle = draggingPointElement.querySelector('div')
                  if (innerCircle) {
                    innerCircle.style.opacity = '0.7'
                  }
                }
                return
              }
            }
          }
          draggingPointElement = null
        },
        onDragEnd: () => {
          // Restore opacity for point segment if we were dragging one
          if (draggingPointElement) {
            const innerCircle = draggingPointElement.querySelector('div')
            if (innerCircle) {
              innerCircle.style.opacity = '1'
            }
            draggingPointElement = null
          }
        },
        onDrag: async ({ selected, intersectionPoint }) => {
          if (isSolveInProgress) {
            return
          }

          const snapshot = self.getSnapshot()
          const selectedIds = snapshot.context.selectedIds
          const sceneGraphDelta =
            snapshot.context.sketchExecOutcome?.sceneGraphDelta

          if (!sceneGraphDelta) {
            return
          }

          // Get the entity under cursor
          // sceneInfra also handles CSS2DObject detection, so selected will be set
          // for both three.js objects and CSS2DObjects (as their parent Group)
          let entityUnderCursorId: number | null = null

          // Check if selected is already a Group with a numeric name (segment group)
          // This handles CSS2DObjects where sceneInfra sets selected to the parent Group
          if (selected instanceof Group) {
            const groupId = Number(selected.name)
            if (!Number.isNaN(groupId)) {
              // Check if it's a point or line segment by userData.type or by checking children
              const isPointSegment =
                selected.userData?.type === 'point' ||
                selected.children.some(
                  (child) => child.userData?.type === 'handle'
                )
              const isLineSegment =
                selected.userData?.type === SEGMENT_TYPE_LINE ||
                selected.children.some(
                  (child) => child.userData?.type === STRAIGHT_SEGMENT_BODY
                )

              if (isPointSegment || isLineSegment) {
                entityUnderCursorId = groupId
              }
            }
          }

          // If not found above, try getParentGroup (for three.js objects that aren't already Groups)
          if (!entityUnderCursorId) {
            const groupUnderCursor = getParentGroup(selected, [
              SEGMENT_TYPE_POINT,
              SEGMENT_TYPE_LINE,
            ])
            if (groupUnderCursor) {
              entityUnderCursorId = Number(groupUnderCursor.name)
            }
          }

          // If no entity under cursor and no selectedIds, nothing to do
          if (!entityUnderCursorId && selectedIds.length === 0) {
            return
          }

          isSolveInProgress = true
          const twoD = intersectionPoint.twoD
          const dragVec = twoD.clone().sub(lastSuccessfulDragFromPoint)

          const objects = sceneGraphDelta.new_graph.objects
          const segmentsToEdit: ExistingSegmentCtor[] = []

          // Collect all IDs to edit (entity under cursor + selectedIds)
          const idsToEdit = new Set<number>()
          if (
            entityUnderCursorId !== null &&
            !Number.isNaN(entityUnderCursorId)
          ) {
            idsToEdit.add(entityUnderCursorId)
          }
          selectedIds.forEach((id) => {
            if (!Number.isNaN(id)) {
              idsToEdit.add(id)
            }
          })

          // Build ctors for each segment
          for (const id of idsToEdit) {
            const obj = objects[id]
            if (!obj) {
              continue
            }

            // Skip if not a segment
            if (obj.kind.type !== 'Segment') {
              continue
            }
            const units = baseUnitToNumericSuffix(
              context.kclManager.fileSettings.defaultLengthUnit
            )

            const isEntityUnderCursor = id === entityUnderCursorId
            const ctor = buildSegmentCtorWithDrag({
              objUnderCursor: obj,
              selectedObjects: objects,
              isEntityUnderCursor,
              currentCursorPosition: twoD,
              dragVec: dragVec,
              units,
            })

            if (ctor) {
              segmentsToEdit.push({ id, ctor })
            }
          }

          if (segmentsToEdit.length === 0) {
            isSolveInProgress = false
            return
          }

          const result = await context.rustContext
            .editSegments(
              0,
              context.sketchId,
              segmentsToEdit,
              await jsAppSettings()
            )
            .catch((err) => {
              console.error('failed to edit segment', err)
              return null
            })

          isSolveInProgress = false
          // after successful drag, update the lastSuccessfulDragFromPoint
          lastSuccessfulDragFromPoint = twoD.clone()

          // send event
          if (result) {
            self.send({
              type: 'update sketch outcome',
              data: result,
            })
          }
        },
        onClick: async ({ selected, mouseEvent }) => {
          // Check if selected is already a Group with a numeric name (segment group)
          // This handles CSS2DObjects where sceneInfra sets selected to the parent Group
          let group: Group | null = null
          if (selected instanceof Group) {
            const groupId = Number(selected.name)
            if (!Number.isNaN(groupId)) {
              // Check if it's a point or line segment
              const isPointSegment =
                selected.userData?.type === 'point' ||
                selected.children.some(
                  (child) => child.userData?.type === 'handle'
                )
              const isLineSegment =
                selected.userData?.type === SEGMENT_TYPE_LINE ||
                selected.children.some(
                  (child) => child.userData?.type === STRAIGHT_SEGMENT_BODY
                )

              if (isPointSegment || isLineSegment) {
                group = selected
              }
            }
          }

          // If not found above, try getParentGroup (for three.js objects that aren't already Groups)
          if (!group) {
            group = getParentGroup(selected, [
              SEGMENT_TYPE_POINT,
              SEGMENT_TYPE_LINE,
            ])
          }

          if (group) {
            const newSelectedIds = [Number(group.name)]
            self.send({
              type: 'update selected ids',
              data: { selectedIds: newSelectedIds, duringAreaSelectIds: [] },
            })
            return
          }

          // No segment found - clicked on blank space, clear selection
          // sceneInfra should have detected CSS2DObjects in onMouseDown, so if we get here
          // with no group, it means we clicked on nothing
          self.send({
            type: 'update selected ids',
            data: { selectedIds: [], duringAreaSelectIds: [] },
          })
        },
        onMouseEnter: ({ selected, isAreaSelectActive }) => {
          // Disable hover highlighting during area select
          if (isAreaSelectActive) {
            return
          }
          if (!selected) return
          // Check if it's a line segment mesh
          const mesh = selected
          if (
            mesh.userData?.type === STRAIGHT_SEGMENT_BODY &&
            mesh instanceof Mesh
          ) {
            const snapshot = self.getSnapshot()
            // Combine selectedIds and duringAreaSelectIds for highlighting
            const allSelectedIds = Array.from(
              new Set([
                ...snapshot.context.selectedIds,
                ...snapshot.context.duringAreaSelectIds,
              ])
            )
            updateLineSegmentHover(mesh, true, allSelectedIds)
            lastHoveredMesh = mesh
          }
        },
        onMouseLeave: ({ selected, isAreaSelectActive }) => {
          // Disable hover highlighting during area select
          if (isAreaSelectActive) {
            return
          }
          // Clear hover state for the previously hovered mesh
          if (lastHoveredMesh) {
            const snapshot = self.getSnapshot()
            // Combine selectedIds and duringAreaSelectIds for highlighting
            const allSelectedIds = Array.from(
              new Set([
                ...snapshot.context.selectedIds,
                ...snapshot.context.duringAreaSelectIds,
              ])
            )
            updateLineSegmentHover(lastHoveredMesh, false, allSelectedIds)
            lastHoveredMesh = null
          }
          // Also handle if selected is provided (for safety)
          if (selected) {
            const mesh = selected
            if (
              mesh.userData?.type === STRAIGHT_SEGMENT_BODY &&
              mesh instanceof Mesh
            ) {
              const snapshot = self.getSnapshot()
              // Combine selectedIds and duringAreaSelectIds for highlighting
              const allSelectedIds = Array.from(
                new Set([
                  ...snapshot.context.selectedIds,
                  ...snapshot.context.duringAreaSelectIds,
                ])
              )
              updateLineSegmentHover(mesh, false, allSelectedIds)
            }
          }
        },
        onAreaSelectStart: ({ startPoint }) => {
          const scaledStartPoint = startPoint.threeD
            .clone()
            .multiplyScalar(context.sceneInfra.baseUnitMultiplier)
          // Area select started - create the selection box visual and clear any previous area select
          if (startPoint.threeD) {
            updateSelectionBox(scaledStartPoint, scaledStartPoint)
            // Clear any previous duringAreaSelectIds
            self.send({
              type: 'update selected ids',
              data: { duringAreaSelectIds: [] },
            })
          }
        },
        onAreaSelect: ({ startPoint, currentPoint }) => {
          const scaledStartPoint = startPoint.threeD
            .clone()
            .multiplyScalar(context.sceneInfra.baseUnitMultiplier)
          const scaledCurrentPoint = currentPoint.threeD
            .clone()
            .multiplyScalar(context.sceneInfra.baseUnitMultiplier)
          // Update selection box visual during drag
          if (scaledStartPoint && scaledCurrentPoint) {
            updateSelectionBox(scaledStartPoint, scaledCurrentPoint)

            // Calculate selection box bounds in screen space for contains check
            const camera = context.sceneInfra.camControls.camera
            const renderer = context.sceneInfra.renderer
            const viewportSize = new Vector2(
              renderer.domElement.clientWidth,
              renderer.domElement.clientHeight
            )

            const startScreen = scaledStartPoint.clone().project(camera)
            const currentScreen = scaledCurrentPoint.clone().project(camera)

            const startPx = new Vector2(
              ((startScreen.x + 1) / 2) * viewportSize.x,
              ((1 - startScreen.y) / 2) * viewportSize.y
            )
            const currentPx = new Vector2(
              ((currentScreen.x + 1) / 2) * viewportSize.x,
              ((1 - currentScreen.y) / 2) * viewportSize.y
            )

            const boxMinPx = new Vector2(
              Math.min(startPx.x, currentPx.x),
              Math.min(startPx.y, currentPx.y)
            )
            const boxMaxPx = new Vector2(
              Math.max(startPx.x, currentPx.x),
              Math.max(startPx.y, currentPx.y)
            )

            // Determine selection mode based on drag direction
            const isIntersectionBox = startPx.x > currentPx.x
            if (isIntersectionBox) {
              // Intersection box: find segments that intersect with the selection box
              const intersectingIds = findIntersectingSegments(
                boxMinPx,
                boxMaxPx
              )

              // Update duringAreaSelectIds (temporary selection during drag)
              self.send({
                type: 'update selected ids',
                data: { duringAreaSelectIds: intersectingIds },
              })
            } else {
              // Contains box: find segments fully contained within the selection box
              const containedIds = findContainedSegments(boxMinPx, boxMaxPx)

              // Update duringAreaSelectIds (temporary selection during drag)
              self.send({
                type: 'update selected ids',
                data: { duringAreaSelectIds: containedIds },
              })
            }
          }
        },
        onAreaSelectEnd: () => {
          // Remove selection box visual
          removeSelectionBox()

          // Merge duringAreaSelectIds into selectedIds and clear duringAreaSelectIds
          const snapshot = self.getSnapshot()
          const duringAreaSelectIds = snapshot.context.duringAreaSelectIds

          if (duringAreaSelectIds.length > 0) {
            // Merge duringAreaSelectIds into selectedIds
            const mergedIds = Array.from(
              new Set([...snapshot.context.selectedIds, ...duringAreaSelectIds])
            )
            self.send({
              type: 'update selected ids',
              data: { selectedIds: mergedIds, duringAreaSelectIds: [] },
            })
          } else {
            // Just clear duringAreaSelectIds
            self.send({
              type: 'update selected ids',
              data: { duringAreaSelectIds: [] },
            })
          }
        },
      })
    },
    'clear hover callbacks': ({ self, context }) => {
      // Clear hover callbacks to prevent interference with tool operations
      context.sceneInfra.setCallbacks({
        onMouseEnter: () => {},
        onMouseLeave: () => {},
        onAreaSelectStart: () => {},
        onAreaSelect: () => {},
        onAreaSelectEnd: () => {},
      })

      // Clear any currently hovered line segment meshes
      const snapshot = self.getSnapshot()
      const selectedIds = snapshot.context.selectedIds
      const sketchSegments =
        context.sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
      if (sketchSegments) {
        sketchSegments.traverse((child) => {
          if (
            child instanceof Mesh &&
            child.userData?.type === STRAIGHT_SEGMENT_BODY &&
            child.userData.isHovered === true
          ) {
            updateLineSegmentHover(child, false, selectedIds)
          }
        })
      }

      // Clean up selection box if it exists
      const selectionBoxGroup = sketchSegments?.getObjectByName('selectionBox')
      if (selectionBoxGroup) {
        selectionBoxGroup.traverse((child) => {
          if (
            child instanceof CSS2DObject &&
            child.element instanceof HTMLElement
          ) {
            child.element.remove()
          }
        })
        selectionBoxGroup.removeFromParent()
      }
    },
    'cleanup sketch solve group': ({ context }) => {
      const sketchSegments =
        context.sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
      if (!sketchSegments || !(sketchSegments instanceof Group)) {
        console.log('yo no sketch segments to clean up')
        return
      }
      // We have to manually remove the CSS2DObjects
      // as they don't get removed when the group is removed
      sketchSegments.traverse((object) => {
        if (object instanceof CSS2DObject) {
          object.element.remove()
          object.remove()
        }
      })
      disposeGroupChildren(sketchSegments)
    },
    'send unequip to tool': sendTo(CHILD_TOOL_ID, { type: 'unequip' }),
    'send update selection to equipped tool': sendTo(CHILD_TOOL_ID, {
      type: 'update selection',
    }),
    'send updated selection to move tool': sendTo('moveTool', {
      type: 'update selection',
    }),
    'store pending tool': assign(({ event }) => {
      assertEvent(event, 'equip tool')
      return { pendingToolName: event.data.tool }
    }),
    'send tool equipped to parent': sendParent(({ context }) => ({
      type: 'sketch solve tool changed',
      data: { tool: context.sketchSolveToolName },
    })),
    'send tool unequipped to parent': sendParent({
      type: 'sketch solve tool changed',
      data: { tool: null },
    }),
    'update selected ids': assign(({ event, context }) => {
      assertEvent(event, 'update selected ids')

      const updates: Partial<SketchSolveContext> = {}

      // Handle duringAreaSelectIds update (for area select during drag)
      if (event.data.duringAreaSelectIds !== undefined) {
        updates.duringAreaSelectIds = event.data.duringAreaSelectIds
      }

      // Handle regular selectedIds update (for click selection, etc.)
      if (event.data.selectedIds !== undefined) {
        // If empty array is provided, clear the selection
        if (event.data.selectedIds.length === 0) {
          updates.selectedIds = []
        } else {
          const first = event.data.selectedIds[0]
          if (
            event.data.selectedIds.length === 1 &&
            first &&
            context.selectedIds.includes(first)
          ) {
            // If only one ID is selected and it's already in the selection, remove only it from the selection
            updates.selectedIds = context.selectedIds.filter(
              (id) => id !== first
            )
          } else {
            // Merge new IDs with existing selection
            const result = Array.from(
              new Set([...context.selectedIds, ...event.data.selectedIds])
            )
            updates.selectedIds = result
          }
        }
      }

      return updates
    }),
    'refresh selection styling': ({ context }) => {
      // Update selection styling for all existing sketch-solve segments
      if (!context.sketchExecOutcome?.sceneGraphDelta) {
        return
      }
      const sceneGraphDelta = context.sketchExecOutcome.sceneGraphDelta
      const objects = sceneGraphDelta.new_graph.objects
      const orthoFactor = orthoScale(context.sceneInfra.camControls.camera)
      const factor =
        (context.sceneInfra.camControls.camera instanceof OrthographicCamera ||
        !context.sceneEntitiesManager.axisGroup
          ? orthoFactor
          : perspScale(
              context.sceneInfra.camControls.camera,
              context.sceneEntitiesManager.axisGroup
            )) / context.sceneInfra.baseUnitMultiplier

      // Combine selectedIds and duringAreaSelectIds for highlighting
      const allSelectedIds = Array.from(
        new Set([...context.selectedIds, ...context.duringAreaSelectIds])
      )

      sceneGraphDelta.new_graph.objects.forEach((obj) => {
        if (obj.kind.type === 'Sketch' || obj.kind.type === 'Constraint') {
          return
        }
        const group = context.sceneInfra.scene.getObjectByName(String(obj.id))
        if (!(group instanceof Group)) {
          return
        }
        const ctor = buildSegmentCtorFromObject(obj, objects)
        if (!ctor) {
          return
        }
        updateSegmentGroup({
          group,
          input: ctor,
          selectedIds: allSelectedIds,
          scale: factor,
          theme: context.sceneInfra.theme,
        })
      })
    },
    'update sketch outcome': assign(({ event, self, context }) => {
      assertEvent(event, 'update sketch outcome')
      context.codeManager.updateCodeEditor(event.data.kclSource.text)
      const sceneGraphDelta = event.data.sceneGraphDelta
      const objects = sceneGraphDelta.new_graph.objects
      const orthoFactor = orthoScale(context.sceneInfra.camControls.camera)
      const factor =
        (context.sceneInfra.camControls.camera instanceof OrthographicCamera ||
        !context.sceneEntitiesManager.axisGroup
          ? orthoFactor
          : perspScale(
              context.sceneInfra.camControls.camera,
              context.sceneEntitiesManager.axisGroup
            )) / context.sceneInfra.baseUnitMultiplier
      const sketchSegments = context.sceneInfra.scene.children.find(
        ({ userData }) => userData?.type === SKETCH_SOLVE_GROUP
      )

      // If invalidates_ids is true, we need to delete everything and start fresh
      // because the old IDs can't be trusted
      if (sceneGraphDelta.invalidates_ids && sketchSegments instanceof Group) {
        disposeGroupChildren(sketchSegments)
      } else {
        // This invalidation logic is kinda based on some heuristics and is not exchaustive.
        // so there are bugs, it's here to let some direct editing of the code from
        // hackSetProgram in `src/editor/plugins/lsp/kcl/index.ts`.
        // The proper way to do this is to get an invalidation signal from the rust side.
        const invalidateScene = sketchSegments?.children.some((child) => {
          const childId = Number(child.name)
          // check if number
          if (Number.isNaN(childId)) {
            return
          }
          // check id is not greater than new_graph.objects length
          return childId >= sceneGraphDelta.new_graph.objects.length
        })
        if (invalidateScene) {
          sketchSegments?.children.forEach((child) => {
            context.sceneInfra.scene.remove(child)
          })
        }
      }

      // TODO ask Jon if there's a better way to determine what objects are part of the current sketch
      let skipBecauseBeforeCurrentSketch = true
      let skipBecauseAfterCurrentSketch = false
      sceneGraphDelta.new_graph.objects.forEach((obj) => {
        if (obj.kind.type === 'Sketch' && obj.id === context.sketchId) {
          skipBecauseBeforeCurrentSketch = false
        }
        if (obj.kind.type === 'Sketch' && obj.id > context.sketchId) {
          skipBecauseAfterCurrentSketch = true
        }
        if (skipBecauseBeforeCurrentSketch || skipBecauseAfterCurrentSketch) {
          return
        }
        if (obj.kind.type === 'Sketch' || obj.kind.type === 'Constraint') {
          return
        }
        const group = context.sceneInfra.scene.getObjectByName(String(obj.id))
        const ctor = buildSegmentCtorFromObject(obj, objects)
        if (!(group instanceof Group)) {
          if (!ctor) {
            return
          }
          initSegmentGroup({
            input: ctor,
            theme: context.sceneInfra.theme,
            scale: factor,
            id: obj.id,
            onUpdateSketchOutcome: (data) =>
              self.send({
                type: 'update sketch outcome',
                data,
              }),
          })
            .then((group) => {
              const sketchSceneGroup =
                context.sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
              if (sketchSceneGroup) {
                group.traverse((child) => {
                  child.layers.set(SKETCH_LAYER)
                })
                group.layers.set(SKETCH_LAYER)
                sketchSceneGroup.add(group)
              }
            })
            .catch((e) => {
              console.error('Failed to init PointSegment for object', obj.id, e)
            })
          return
        }
        if (!ctor) {
          return
        }

        // Combine selectedIds and duringAreaSelectIds for highlighting
        const allSelectedIds = Array.from(
          new Set([...context.selectedIds, ...context.duringAreaSelectIds])
        )

        updateSegmentGroup({
          group,
          input: ctor,
          selectedIds: allSelectedIds,
          scale: factor,
          theme: context.sceneInfra.theme,
        })
      })

      return {
        sketchExecOutcome: {
          kclSource: event.data.kclSource,
          sceneGraphDelta: event.data.sceneGraphDelta,
        },
      }
    }),
    'spawn tool': assign(({ event, spawn, context }) => {
      // Determine which tool to spawn based on event type
      let nameOfToolToSpawn: EquipTool

      if (event.type === 'equip tool') {
        nameOfToolToSpawn = event.data.tool
      } else if (
        event.type === CHILD_TOOL_DONE_EVENT &&
        context.pendingToolName
      ) {
        nameOfToolToSpawn = context.pendingToolName
      } else {
        console.error('Cannot determine tool to spawn')
        return {}
      }
      // this type-annotation informs spawn tool of the association between the EquipTools type and the machines in equipTools
      // It's not an type assertion. TS still checks that _spawn is assignable to SpawnToolActor.
      const typedSpawn: SpawnToolActor = spawn
      typedSpawn(nameOfToolToSpawn, {
        id: CHILD_TOOL_ID,
        input: {
          sceneInfra: context.sceneInfra,
          rustContext: context.rustContext,
          kclManager: context.kclManager,
          sketchId: context.sketchId,
        },
      })

      return {
        sketchSolveToolName: nameOfToolToSpawn,
        pendingToolName: undefined, // Clear the pending tool after spawning
      }
    }),
  },
  actors: {
    moveToolActor: createMachine({
      /* ... */
    }),
    ...equipTools,
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QGUDWYAuBjAFgAmQHsAbANzDwFlCIwBiMADwEsMBtABgF1FQAHQrFbNCAO14hGiAIwB2ABwBWAHTyAbAGZFAFiXyOAJg0BOADQgAnolkrpHQwe1rFz59I0BfD+bSZcBEnIqGnoAVz4IAEMMClgwYjAsDBFRTh4kEAEhZLEJKQRZNXllRX1jDQM1A3lpA1lzKwQAWgNjA2U1aTVC+07jRQ0NNS8fdGx8IjIKalo6cKiYvFgx-0JQ7EIAWzA0iSzhXIz82sV241qNeW1L+X7nBsQWk2VDaXV1cp1tGxGQX3GAlNgrNQqIwABHULMPh4DCEEi7DL7HLiI6IbSKFRXAyKWRODTaDiFbQPZpGaTKIZvGzyGqlWTSbS-f7+SZBGb0LCEZiiLDMWiidjcPaCA6o0CNJpKSnGYyyGwExW6eqSRBGDjGVSaHR6QwmZkrCaBaYhOgAGR5cAAopDIsQzWBRFAMDhEfxRSiJJLpSY5QrrgH5Cr8urNeotLpSnrjAa-EagRy6AA1MAAJ2SWDtbsyHpSXsePtl8oGAYJQfMIY0Gq1Ed1Rhj3j+hsB7NNAAlCKnmAAvMQYLPCpG5w4SgsqX3FpVl4Nqqth7WR-T12MAtkmkERaKxeKJGIQPD82DZ5F5jLe8dF-1K8uqhChms6qPLxss+Ot2jKTaEIKRUT7uIJEkdAQGIYDKDypCEOgn7fmAAAq8LEMew7iretTnJSQx1IoHDaHIZiWNYaglPIlRqBi+jyFWTIvs2a7AmBX4-n+Sw7kBaapp2yh8MQ0QAGadpsMHkAhCKDu62SnqAxytO09ikZ0QZ4toOKkrU2iqJUNRqLK0guBwtQrqyxoMcJFC-v+bEYAwkLQrCiHIZJI5oXYLyyP0xhUdUcqYvIpIGO4qilMYHBDKROKVEZb7rmBoRCE69kkHMYK2TCcJiekElinkMi4cUGhdHi6iyKFQwkoRCARiUiiysYKl4Woai4VFLYxcocU8lAiXEDZUJpQ54k5k5qH5HKFKtKF2i6CYshkaS3zFDYuIaAooUltILX0RyyiwAA7qwuCdd1dCMLA-YxMoIFgsokRJFxjnZWiCByu0tzGEUuE1RwOlqKS5HFHps0VAM3SkRttFxq1pmghCfV8Ed6U9ad51gVdYG3XCqbKA9npPXY3zKAYrSXJc0hqRhoOhZUjikXKXiNqIITwBkr5QxyIrDTlCBVG5HlebcS1+RVUoXnKQYGTpQZVJtJnbUx5ksQBu4c490mICtsiE20s16U1ROqRVdjtAoE1E1WOGyDLCYhO18VdYjKu42rlX9ITpEFeo1Q6IopJVsUpyFIMmIYooVvvmBe0HTgCOIY7Um3q0Gk1WR5yDCYbx-XUyhTUGSoGES0sQ6uss20wwhOnHznHLoxHfN01yyk4Okqo0sqaR93yYnVNNh21MOpfDCUO0OnN40YmvSO9XRKO9EuksHygMjYem4p5OLg14QA */
  context: ({ input }): SketchSolveContext => {
    return {
      sketchSolveToolName: null,
      selectedIds: [],
      duringAreaSelectIds: [],
      initialPlane: input?.initialSketchSolvePlane ?? undefined,
      sketchId: input?.sketchId || 0,
      codeManager: input.codeManager,
      sceneInfra: input.sceneInfra,
      sceneEntitiesManager: input.sceneEntitiesManager,
      rustContext: input.rustContext,
      kclManager: input.kclManager,
    }
  },
  id: 'Sketch Solve Mode',
  initial: 'move and select',
  on: {
    exit: {
      target: '#Sketch Solve Mode.exiting',
      actions: [
        'send unequip to tool',
        'send tool unequipped to parent',
        'cleanup sketch solve group',
      ],
      description:
        'the outside world can request that sketch mode exit, but it needs to handle its own teardown first.',
    },
    'update selection': {
      actions: [
        'send update selection to equipped tool',
        'send updated selection to move tool',
      ],
      description:
        'sketch mode consumes the current selection from its source of truth (currently modelingMachine). Whenever it receives',
    },
    'update sketch outcome': {
      actions: 'update sketch outcome',
      description:
        'Updates the sketch execution outcome in the context when tools complete operations',
    },
    'unequip tool': {
      actions: 'send unequip to tool',
    },
    coincident: {
      actions: async ({ self, context }) => {
        // TODO this is not how coincident should operate long term, as it should be an equipable tool
        const result = await context.rustContext.addConstraint(
          0,
          context.sketchId,
          {
            type: 'Coincident',
            points: context.selectedIds,
          },
          await jsAppSettings()
        )
        if (result) {
          self.send({
            type: 'update sketch outcome',
            data: result,
          })
        }
      },
    },
    Distance: {
      actions: async ({ self, context }) => {
        // TODO this is not how coincident should operate long term, as it should be an equipable tool
        let segmentsToConstrain = context.selectedIds
        if (segmentsToConstrain.length === 1) {
          const first =
            context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects[
              segmentsToConstrain[0]
            ]
          if (
            first?.kind?.type === 'Segment' &&
            first?.kind?.segment?.type === 'Line'
          ) {
            segmentsToConstrain = [
              first.kind.segment.start,
              first.kind.segment.end,
            ]
          }
        }
        const currentSelections = segmentsToConstrain
          .map(
            (id) =>
              context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects[id]
          )
          .filter(Boolean)
        let distance = 5
        const units = baseUnitToNumericSuffix(
          context.kclManager.fileSettings.defaultLengthUnit
        )
        // Calculate distance between two points if both are point segments
        if (currentSelections.length === 2) {
          const first = currentSelections[0]
          const second = currentSelections[1]
          if (
            first?.kind?.type === 'Segment' &&
            first?.kind.segment?.type === 'Point' &&
            second?.kind?.type === 'Segment' &&
            second?.kind.segment?.type === 'Point'
          ) {
            const point1 = {
              x: first.kind.segment.position.x,
              y: first.kind.segment.position.y,
            }
            const point2 = {
              x: second.kind.segment.position.x,
              y: second.kind.segment.position.y,
            }
            const distanceResult = distanceBetweenPoint2DExpr(point1, point2)
            if (!(distanceResult instanceof Error)) {
              distance = roundOff(distanceResult.distance)
            }
          }
        }
        const result = await context.rustContext.addConstraint(
          0,
          context.sketchId,
          {
            type: 'Distance',
            distance: { value: distance, units },
            points: segmentsToConstrain,
          },
          await jsAppSettings()
        )
        if (result) {
          self.send({
            type: 'update sketch outcome',
            data: result,
          })
        }
      },
    },
    Parallel: {
      actions: async ({ self, context }) => {
        // TODO this is not how coincident should operate long term, as it should be an equipable tool
        const result = await context.rustContext.addConstraint(
          0,
          context.sketchId,
          {
            type: 'Parallel',
            lines: context.selectedIds,
          },
          await jsAppSettings()
        )
        if (result) {
          self.send({
            type: 'update sketch outcome',
            data: result,
          })
        }
      },
    },
    LinesEqualLength: {
      actions: async ({ self, context }) => {
        // TODO this is not how LinesEqualLength should operate long term, as it should be an equipable tool
        const result = await context.rustContext.addConstraint(
          0,
          context.sketchId,
          {
            type: 'LinesEqualLength',
            lines: context.selectedIds,
          },
          await jsAppSettings()
        )
        if (result) {
          self.send({
            type: 'update sketch outcome',
            data: result,
          })
        }
      },
    },
    Vertical: {
      actions: async ({ self, context }) => {
        let result
        for (const id of context.selectedIds) {
          // TODO this is not how Vertical should operate long term, as it should be an equipable tool
          result = await context.rustContext.addConstraint(
            0,
            context.sketchId,
            {
              type: 'Vertical',
              line: id,
            },
            await jsAppSettings()
          )
        }
        if (result) {
          self.send({
            type: 'update sketch outcome',
            data: result,
          })
        }
      },
    },
    Horizontal: {
      actions: async ({ self, context }) => {
        let result
        for (const id of context.selectedIds) {
          // TODO this is not how Horizontal should operate long term, as it should be an equipable tool
          result = await context.rustContext.addConstraint(
            0,
            context.sketchId,
            {
              type: 'Horizontal',
              line: id,
            },
            await jsAppSettings()
          )
        }
        if (result) {
          self.send({
            type: 'update sketch outcome',
            data: result,
          })
        }
      },
    },
    'update selected ids': {
      actions: ['update selected ids', 'refresh selection styling'],
    },
    'delete selected': {
      actions: async ({ self, context }) => {
        const selectedIds = context.selectedIds

        // Only proceed if there are selected IDs
        if (selectedIds.length === 0) {
          return
        }

        // Call deleteObjects with the selected segment IDs
        const result = await context.rustContext
          .deleteObjects(
            0,
            context.sketchId,
            [],
            selectedIds,
            await jsAppSettings()
          )
          .catch((err) => {
            console.error('failed to delete objects', err)
            return null
          })

        if (result) {
          // Clear selection after deletion
          self.send({
            type: 'update selected ids',
            data: { selectedIds: [], duringAreaSelectIds: [] },
          })

          // Send the update sketch outcome event
          self.send({
            type: 'update sketch outcome',
            data: result,
          })
        }
      },
    },
  },
  states: {
    'move and select': {
      entry: ['setUpOnDragAndSelectionClickCallbacks'],
      on: {
        'equip tool': {
          target: 'using tool',
          actions: 'store pending tool',
        },
      },
      invoke: {
        id: 'moveTool',
        input: {},
        onDone: {
          target: 'exiting',
        },
        onError: {
          target: 'exiting',
        },
        src: 'moveToolActor',
      },
      description:
        'The base state of sketch mode is to all the user to move around the scene and select geometry.',
    },

    'using tool': {
      on: {
        'unequip tool': {
          target: 'unequipping tool',
          actions: ['send unequip to tool'],
          reenter: true,
        },

        'equip tool': {
          target: 'switching tool',
          actions: ['send unequip to tool', 'store pending tool'],
        },
      },

      description:
        'Tools are workflows that create or modify geometry in the sketch scene after conditions are met. Some, like the Dimension, Center Rectangle, and Tangent tools, are finite, which they signal by reaching a final state. Some, like the Spline tool, appear to be infinite. In these cases, it is up to the tool Actor to receive whatever signal (such as the Esc key for Spline) necessary to reach a final state and unequip itself.\n\nTools can request to be unequipped from the outside by a "unequip tool" event sent to the sketch machine. This will sendTo the toolInvoker actor.',

      entry: [
        'spawn tool',
        'send tool equipped to parent',
        'clear hover callbacks',
      ],
    },

    'switching tool': {
      on: {
        [CHILD_TOOL_DONE_EVENT]: {
          target: 'using tool',
          actions: [
            () => console.log('switched tools with xstate.done.actor.tool'),
          ],
        },
      },

      description:
        'Intermediate state while the current tool is cleaning up before spawning a new tool.',

      exit: [() => console.log('exiting switching tool')],
    },

    exiting: {
      type: 'final',
      description: 'Place any teardown code here.',
    },

    'unequipping tool': {
      on: {
        [CHILD_TOOL_DONE_EVENT]: {
          target: 'move and select',
          actions: ['send tool unequipped to parent'],
        },
      },

      description: `Intermediate state, same as the "switching tool" state, but for unequip`,
    },
  },

  entry: [
    'initialize intersection plane',
    'setUpOnDragAndSelectionClickCallbacks',
  ],
})
