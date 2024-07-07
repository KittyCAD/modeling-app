import { getEventForSegmentSelection } from 'lib/selections'
import {
  editorManager,
  kclManager,
  sceneEntitiesManager,
  sceneInfra,
} from 'lib/singletons'
import {
  Intersection,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Object3DEventMap,
  OrthographicCamera,
  Points,
  Vector2,
  Vector3,
} from 'three'
import {
  EXTRA_SEGMENT_HANDLE,
  PROFILE_START,
  STRAIGHT_SEGMENT,
  TANGENTIAL_ARC_TO_SEGMENT,
  getParentGroup,
  sketchGroupFromPathToNode,
} from './sceneEntities'
import { trap } from 'lib/trap'
import { addNewSketchLn } from 'lang/std/sketch'
import { CallExpression, PathToNode, parse, recast } from 'lang/wasm'
import { ARROWHEAD, X_AXIS, Y_AXIS } from './sceneInfra'
import { getNodeFromPath } from 'lang/queryAst'
import { getThemeColorForThreeJs } from 'lib/theme'
import { orthoScale, perspScale } from './helpers'
import { ModelingMachineContext } from 'machines/modelingMachine'

export interface OnMouseEnterLeaveArgs {
  selected: Object3D<Object3DEventMap>
  dragSelected?: Object3D<Object3DEventMap>
  mouseEvent: MouseEvent
}

export interface OnDragCallbackArgs extends OnMouseEnterLeaveArgs {
  intersectionPoint: {
    twoD: Vector2
    threeD: Vector3
  }
  intersects: Intersection<Object3D<Object3DEventMap>>[]
}
export interface OnClickCallbackArgs {
  mouseEvent: MouseEvent
  intersectionPoint?: {
    twoD: Vector2
    threeD: Vector3
  }
  intersects: Intersection<Object3D<Object3DEventMap>>[]
  selected?: Object3D<Object3DEventMap>
}

export interface OnMoveCallbackArgs {
  mouseEvent: MouseEvent
  intersectionPoint: {
    twoD: Vector2
    threeD: Vector3
  }
  intersects: Intersection<Object3D<Object3DEventMap>>[]
  selected?: Object3D<Object3DEventMap>
}

interface Callbacks {
  onDragStart: (arg: OnDragCallbackArgs) => void
  onDragEnd: (arg: OnDragCallbackArgs) => void
  onDrag: (arg: OnDragCallbackArgs) => void
  onMove: (arg: OnMoveCallbackArgs) => void
  onClick: (arg: OnClickCallbackArgs) => void
  onMouseEnter: (arg: OnMouseEnterLeaveArgs) => void
  onMouseLeave: (arg: OnMouseEnterLeaveArgs) => void
}

type SetCallbacksWithCtx = (context: ModelingMachineContext) => Callbacks

const onMousEnterLeaveCallbacks = {
  onMouseEnter: ({ selected, dragSelected }: OnMouseEnterLeaveArgs) => {
    if ([X_AXIS, Y_AXIS].includes(selected?.userData?.type)) {
      const obj = selected as Mesh
      const mat = obj.material as MeshBasicMaterial
      mat.color.set(obj.userData.baseColor)
      mat.color.offsetHSL(0, 0, 0.5)
    }
    const parent = getParentGroup(selected, [
      STRAIGHT_SEGMENT,
      TANGENTIAL_ARC_TO_SEGMENT,
      PROFILE_START,
    ])
    if (parent?.userData?.pathToNode) {
      const updatedAst = parse(recast(kclManager.ast))
      if (trap(updatedAst)) return
      const _node = getNodeFromPath<CallExpression>(
        updatedAst,
        parent.userData.pathToNode,
        'CallExpression'
      )
      if (trap(_node, { suppress: true })) return
      const node = _node.node
      editorManager.setHighlightRange([node.start, node.end])
      const yellow = 0xffff00
      colorSegment(selected, yellow)
      const extraSegmentGroup = parent.getObjectByName(EXTRA_SEGMENT_HANDLE)
      if (extraSegmentGroup) {
        extraSegmentGroup.traverse((child) => {
          if (child instanceof Points || child instanceof Mesh) {
            child.material.opacity = dragSelected ? 0 : 1
          }
        })
      }
      const orthoFactor = orthoScale(sceneInfra.camControls.camera)

      const factor =
        (sceneInfra.camControls.camera instanceof OrthographicCamera
          ? orthoFactor
          : perspScale(sceneInfra.camControls.camera, parent)) /
        sceneInfra._baseUnitMultiplier
      if (parent.name === STRAIGHT_SEGMENT) {
        sceneEntitiesManager.updateStraightSegment({
          from: parent.userData.from,
          to: parent.userData.to,
          group: parent,
          scale: factor,
        })
      } else if (parent.name === TANGENTIAL_ARC_TO_SEGMENT) {
        sceneEntitiesManager.updateTangentialArcToSegment({
          prevSegment: parent.userData.prevSegment,
          from: parent.userData.from,
          to: parent.userData.to,
          group: parent,
          scale: factor,
        })
      }
      return
    }
    editorManager.setHighlightRange([0, 0])
  },
  onMouseLeave: ({ selected, ...rest }: OnMouseEnterLeaveArgs) => {
    editorManager.setHighlightRange([0, 0])
    const parent = getParentGroup(selected, [
      STRAIGHT_SEGMENT,
      TANGENTIAL_ARC_TO_SEGMENT,
      PROFILE_START,
    ])
    if (parent) {
      const orthoFactor = orthoScale(sceneInfra.camControls.camera)

      const factor =
        (sceneInfra.camControls.camera instanceof OrthographicCamera
          ? orthoFactor
          : perspScale(sceneInfra.camControls.camera, parent)) /
        sceneInfra._baseUnitMultiplier
      if (parent.name === STRAIGHT_SEGMENT) {
        sceneEntitiesManager.updateStraightSegment({
          from: parent.userData.from,
          to: parent.userData.to,
          group: parent,
          scale: factor,
        })
      } else if (parent.name === TANGENTIAL_ARC_TO_SEGMENT) {
        sceneEntitiesManager.updateTangentialArcToSegment({
          prevSegment: parent.userData.prevSegment,
          from: parent.userData.from,
          to: parent.userData.to,
          group: parent,
          scale: factor,
        })
      }
    }
    const isSelected = parent?.userData?.isSelected
    colorSegment(
      selected,
      isSelected
        ? 0x0000ff
        : parent?.userData?.baseColor ||
            getThemeColorForThreeJs(sceneInfra._theme)
    )
    const extraSegmentGroup = parent?.getObjectByName(EXTRA_SEGMENT_HANDLE)
    if (extraSegmentGroup) {
      extraSegmentGroup.traverse((child) => {
        if (child instanceof Points || child instanceof Mesh) {
          child.material.opacity = 0
        }
      })
    }
    if ([X_AXIS, Y_AXIS].includes(selected?.userData?.type)) {
      const obj = selected as Mesh
      const mat = obj.material as MeshBasicMaterial
      mat.color.set(obj.userData.baseColor)
      if (obj.userData.isSelected) mat.color.offsetHSL(0, 0, 0.2)
    }
  },
} as const

export const idleCallbacks: SetCallbacksWithCtx = (context) => {
  let addingNewSegmentStatus: 'nothing' | 'pending' | 'added' = 'nothing'
  return {
    onDragStart: () => {},
    onDragEnd: () => {},
    onMove: () => {},
    ...onMousEnterLeaveCallbacks,
    onClick: (args) => {
      if (args?.mouseEvent.which !== 1) return
      if (!args || !args.selected) {
        sceneInfra.modelingSend({
          type: 'Set selection',
          data: {
            selectionType: 'singleCodeCursor',
          },
        })
        return
      }
      const { selected } = args
      const event = getEventForSegmentSelection(selected)
      if (!event) return
      sceneInfra.modelingSend(event)
    },
    onDrag: async ({ selected, intersectionPoint, mouseEvent, intersects }) => {
      if (mouseEvent.which !== 1) return

      const group = getParentGroup(selected, [EXTRA_SEGMENT_HANDLE])
      if (group?.name === EXTRA_SEGMENT_HANDLE) {
        const segGroup = getParentGroup(selected)
        const pathToNode: PathToNode = segGroup?.userData?.pathToNode
        const pathToNodeIndex = pathToNode.findIndex(
          (x) => x[1] === 'PipeExpression'
        )

        const sketchGroup = sketchGroupFromPathToNode({
          pathToNode,
          ast: kclManager.ast,
          programMemory: kclManager.programMemory,
        })
        if (trap(sketchGroup)) return

        const pipeIndex = pathToNode[pathToNodeIndex + 1][0] as number
        if (addingNewSegmentStatus === 'nothing') {
          const prevSegment = sketchGroup.value[pipeIndex - 2]
          const mod = addNewSketchLn({
            node: kclManager.ast,
            programMemory: kclManager.programMemory,
            to: [intersectionPoint.twoD.x, intersectionPoint.twoD.y],
            from: [prevSegment.from[0], prevSegment.from[1]],
            // TODO assuming it's always a straight segments being added
            // as this is easiest, and we'll need to add "tabbing" behavior
            // to support other segment types
            fnName: 'line',
            pathToNode: pathToNode,
            spliceBetween: true,
          })
          addingNewSegmentStatus = 'pending'
          if (trap(mod)) return

          await kclManager.executeAstMock(mod.modifiedAst)
          await sceneEntitiesManager.tearDownSketch({ removeAxis: false })
          sceneEntitiesManager.setupSketch({
            sketchPathToNode: pathToNode,
            maybeModdedAst: kclManager.ast,
            up: context.sketchDetails?.yAxis || [0, 1, 0],
            forward: context.sketchDetails?.zAxis || [0, 0, 1],
            position: context.sketchDetails?.origin || [0, 0, 0],
          })
          addingNewSegmentStatus = 'added'
        } else if (addingNewSegmentStatus === 'added') {
          const pathToNodeForNewSegment = pathToNode.slice(0, pathToNodeIndex)
          pathToNodeForNewSegment.push([pipeIndex - 2, 'index'])
          sceneEntitiesManager.onDragSegment({
            sketchPathToNode: pathToNodeForNewSegment,
            object: selected,
            intersection2d: intersectionPoint.twoD,
            intersects,
          })
        }
        return
      }

      sceneEntitiesManager.onDragSegment({
        object: selected,
        intersection2d: intersectionPoint.twoD,
        intersects,
        sketchPathToNode: context.sketchDetails?.sketchPathToNode || [],
      })
    },
  }
}

function colorSegment(object: any, color: number) {
  const segmentHead = getParentGroup(object, [ARROWHEAD, PROFILE_START])
  if (segmentHead) {
    segmentHead.traverse((child) => {
      if (child instanceof Mesh) {
        child.material.color.set(color)
      }
    })
    return
  }
  const straightSegmentBody = getParentGroup(object, [
    STRAIGHT_SEGMENT,
    TANGENTIAL_ARC_TO_SEGMENT,
  ])
  if (straightSegmentBody) {
    straightSegmentBody.traverse((child) => {
      if (child instanceof Mesh && !child.userData.ignoreColorChange) {
        child.material.color.set(color)
      }
    })
    return
  }
}
