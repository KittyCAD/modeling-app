import type {
  ApiObject,
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { NumericSuffix } from '@rust/kcl-lib/bindings/NumericSuffix'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { SKETCH_SOLVE_GROUP } from '@src/clientSideScene/sceneUtils'
import type { KclManager } from '@src/lang/KclManager'
import { baseUnitToNumericSuffix } from '@src/lang/wasm'
import type RustContext from '@src/lib/rustContext'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { isArray, isRecord } from '@src/lib/utils'
import { distance2d } from '@src/lib/utils2d'
import {
  findClosestApiObjects,
  getSketchHoverDistance,
} from '@src/machines/sketchSolve/interaction/interactionHelpers'
import { toastSketchSolveError } from '@src/machines/sketchSolve/sketchSolveErrors'
import {
  ORIGIN_TARGET,
  type SketchSolveSelectionId,
} from '@src/machines/sketchSolve/sketchSolveSelection'
import { getCurrentSketchObjectsById } from '@src/machines/sketchSolve/sceneGraphUtils'
import {
  getConstraintToolPreparedApply,
  resolveConstraintToolSelectionAction,
  normalizeConstraintToolSelection,
  resolveConstraintToolClickAction,
  type ConstraintToolPreparedApply,
  type ConstraintToolSelectionAction,
} from '@src/machines/sketchSolve/tools/constraintToolHelpers'
import { type ConstraintToolName } from '@src/machines/sketchSolve/tools/constraintToolModel'
import type { BaseToolEvent } from '@src/machines/sketchSolve/tools/sharedToolTypes'
import { isPointSegment } from '@src/machines/sketchSolve/constraints/constraintUtils'
import {
  findContainedSegments,
  findIntersectingSegments,
  isIntersectionSelectionMode,
  project3DToScreen,
  removeSelectionBox,
  type SelectionBoxVisualState,
  updateSelectionBox,
} from '@src/machines/sketchSolve/tools/moveTool/areaSelectUtils'
import { Group, Vector2 } from 'three'
import type { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { assertEvent, assign, fromPromise, setup } from 'xstate'

type ConstraintToolContext = {
  sceneInfra: SceneInfra
  rustContext: RustContext
  kclManager: KclManager
  sketchId: number
  toolName: ConstraintToolName
  didInitialSelectionSync: boolean
  selectionBoxState: SelectionBoxVisualState
  pendingApply?: ConstraintToolPreparedApply
}

type ConstraintToolInput = {
  sceneInfra: SceneInfra
  rustContext: RustContext
  kclManager: KclManager
  sketchId: number
  toolVariant?: string
}

type ConstraintToolApplyResult = {
  kclSource: SourceDelta
  sceneGraphDelta: SceneGraphDelta
  checkpointId?: number | null
}

const constraintToolContextType: ConstraintToolContext = null!
const constraintToolEventType: ConstraintToolEvent = null!
const constraintToolInputType: ConstraintToolInput = null!

function getDefaultLengthUnit(kclManager: KclManager): NumericSuffix {
  return baseUnitToNumericSuffix(
    kclManager.fileSettings.defaultLengthUnit ?? 'mm'
  )
}

type ParentSketchSolveEvent =
  | {
      type: 'update selected ids'
      data: {
        selectedIds?: SketchSolveSelectionId[]
        duringAreaSelectIds?: number[]
        replaceExistingSelection?: true
      }
    }
  | {
      type: 'update hovered id'
      data: {
        hoveredId: SketchSolveSelectionId | null
      }
    }
  | {
      type: 'update sketch outcome'
      data: {
        sourceDelta: SourceDelta
        sceneGraphDelta: SceneGraphDelta
        checkpointId: number | null
      }
    }

type ClosestSelectionTarget = {
  distance: number
  selectionId: SketchSolveSelectionId
  apiObject: ApiObject | null
}

function getSelectionPriority(selectionTarget: ClosestSelectionTarget) {
  if (isPointSegment(selectionTarget.apiObject)) {
    return 1
  }
  if (selectionTarget.selectionId === ORIGIN_TARGET) {
    return 2
  }

  return 3
}

function getClosestSelectionTarget(
  mousePosition: [number, number],
  objects: ApiObject[],
  sceneInfra: SceneInfra
): ClosestSelectionTarget | null {
  const closestObject = findClosestApiObjects(
    mousePosition,
    objects,
    sceneInfra
  )[0]

  const selectionCandidates: ClosestSelectionTarget[] = []
  if (closestObject) {
    selectionCandidates.push({
      distance: closestObject.distance,
      selectionId: closestObject.apiObject.id,
      apiObject: closestObject.apiObject,
    })
  }

  const sketchSolveGroupObject =
    sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
  const sketchSolveGroup =
    sketchSolveGroupObject instanceof Group ? sketchSolveGroupObject : null
  const hoverDistance = getSketchHoverDistance(
    sceneInfra.getClientSceneScaleFactor(sketchSolveGroup)
  )
  const originDistance = distance2d(mousePosition, [0, 0])

  if (originDistance < hoverDistance) {
    selectionCandidates.push({
      distance: originDistance,
      selectionId: ORIGIN_TARGET,
      apiObject: null,
    })
  }

  selectionCandidates.sort((a, b) => {
    const priorityDelta = getSelectionPriority(a) - getSelectionPriority(b)
    if (priorityDelta !== 0) {
      return priorityDelta
    }
    return a.distance - b.distance
  })

  return selectionCandidates[0] ?? null
}

type ConstraintToolEvent =
  | BaseToolEvent
  | {
      type: 'normalize selection'
      selectionIds: SketchSolveSelectionId[]
      objects: ApiObject[]
    }
  | {
      type: 'click selection'
      currentSelectionIds: SketchSolveSelectionId[]
      clickedSelectionId: SketchSolveSelectionId | null
      objects: ApiObject[]
    }
  | {
      type: 'preview area selection'
      currentSelectionIds: SketchSolveSelectionId[]
      candidateSelectionIds: SketchSolveSelectionId[]
      objects: ApiObject[]
    }
  | {
      type: 'commit area selection'
      currentSelectionIds: SketchSolveSelectionId[]
      candidateSelectionIds: SketchSolveSelectionId[]
      objects: ApiObject[]
    }

type ParentSketchSnapshot = {
  context: {
    selectedIds: SketchSolveSelectionId[]
    sketchId: number
    sketchExecOutcome: {
      sceneGraphDelta: SceneGraphDelta
    }
  }
}

function isParentSketchSnapshot(value: unknown): value is ParentSketchSnapshot {
  if (!isRecord(value)) {
    return false
  }

  const { context } = value
  if (!isRecord(context)) {
    return false
  }

  return (
    isArray(context.selectedIds) &&
    typeof context.sketchId === 'number' &&
    isRecord(context.sketchExecOutcome) &&
    isRecord(context.sketchExecOutcome.sceneGraphDelta)
  )
}

function getParentSketchData(self: {
  _parent?: {
    send?: (event: ParentSketchSolveEvent) => void
    getSnapshot?: () => unknown
  }
}): {
  selectedIds: SketchSolveSelectionId[]
  sketchId: number
  objects: ApiObject[]
} | null {
  const snapshot = self._parent?.getSnapshot?.()
  if (!isParentSketchSnapshot(snapshot)) {
    return null
  }

  const objects =
    snapshot.context.sketchExecOutcome.sceneGraphDelta.new_graph.objects
  if (!isArray(objects)) {
    return null
  }

  return {
    selectedIds: snapshot.context.selectedIds,
    sketchId: snapshot.context.sketchId,
    objects,
  }
}

function sendSelectionToParent(
  self: {
    _parent?: {
      send?: (event: ParentSketchSolveEvent) => void
    }
  },
  selectedIds: SketchSolveSelectionId[]
) {
  self._parent?.send?.({
    type: 'update selected ids',
    data: {
      selectedIds,
      duringAreaSelectIds: [],
      replaceExistingSelection: true,
    },
  })
}

function sendDuringAreaSelectionToParent(
  self: {
    _parent?: {
      send?: (event: ParentSketchSolveEvent) => void
    }
  },
  duringAreaSelectIds: number[]
) {
  self._parent?.send?.({
    type: 'update selected ids',
    data: {
      duringAreaSelectIds,
    },
  })
}

function createSelectionBoxVisualState(): SelectionBoxVisualState {
  let selectionBoxObject: CSS2DObject | null = null
  let selectionBoxGroup: Group | null = null
  let labelsWrapper: HTMLElement | null = null
  let boxDiv: HTMLElement | null = null
  let verticalLine: HTMLElement | null = null
  let horizontalLine: HTMLElement | null = null

  return {
    getSelectionBoxObject: () => selectionBoxObject,
    setSelectionBoxObject: (value) => {
      selectionBoxObject = value
    },
    getSelectionBoxGroup: () => selectionBoxGroup,
    setSelectionBoxGroup: (value) => {
      selectionBoxGroup = value
    },
    getLabelsWrapper: () => labelsWrapper,
    setLabelsWrapper: (value) => {
      labelsWrapper = value
    },
    getBoxDiv: () => boxDiv,
    setBoxDiv: (value) => {
      boxDiv = value
    },
    getVerticalLine: () => verticalLine,
    setVerticalLine: (value) => {
      verticalLine = value
    },
    getHorizontalLine: () => horizontalLine,
    setHorizontalLine: (value) => {
      horizontalLine = value
    },
  }
}

function syncCurrentSelectionFromParent({
  self,
}: {
  self: {
    send: (event: ConstraintToolEvent) => void
    _parent?: {
      getSnapshot?: () => unknown
    }
  }
}) {
  const parentData = getParentSketchData(self)
  if (!parentData) {
    return
  }

  self.send({
    type: 'normalize selection',
    selectionIds: parentData.selectedIds,
    objects: parentData.objects,
  })
}

function addConstraintToolListener({
  context,
  self,
}: {
  context: ConstraintToolContext
  self: {
    send: (event: ConstraintToolEvent) => void
    _parent?: {
      send?: (event: ParentSketchSolveEvent) => void
      getSnapshot?: () => unknown
    }
  }
}) {
  const getAreaSelectionIds = ({
    startPoint,
    currentPoint,
    isIntersectionBox,
    objects,
    sketchId,
  }: {
    startPoint: [number, number]
    currentPoint: [number, number]
    isIntersectionBox: boolean
    objects: ApiObject[]
    sketchId: number
  }) => {
    const currentSketchObjects = getCurrentSketchObjectsById(objects, sketchId)
    return isIntersectionBox
      ? findIntersectingSegments(currentSketchObjects, startPoint, currentPoint)
      : findContainedSegments(currentSketchObjects, startPoint, currentPoint)
  }

  context.sceneInfra.setCallbacks({
    onClick: ({ mouseEvent, intersectionPoint }) => {
      if (mouseEvent.which !== 1) {
        return
      }

      const parentData = getParentSketchData(self)
      if (!parentData) {
        return
      }

      const clickedSelectionId =
        intersectionPoint === undefined
          ? null
          : (getClosestSelectionTarget(
              [intersectionPoint.twoD.x, intersectionPoint.twoD.y],
              getCurrentSketchObjectsById(
                parentData.objects,
                parentData.sketchId
              ),
              context.sceneInfra
            )?.selectionId ?? null)

      self.send({
        type: 'click selection',
        currentSelectionIds: parentData.selectedIds,
        clickedSelectionId,
        objects: parentData.objects,
      })
    },
    onMove: ({ intersectionPoint }) => {
      const parentData = getParentSketchData(self)
      if (!parentData) {
        return
      }

      const hoveredId =
        intersectionPoint === undefined
          ? null
          : (getClosestSelectionTarget(
              [intersectionPoint.twoD.x, intersectionPoint.twoD.y],
              getCurrentSketchObjectsById(
                parentData.objects,
                parentData.sketchId
              ),
              context.sceneInfra
            )?.selectionId ?? null)

      self._parent?.send?.({
        type: 'update hovered id',
        data: {
          hoveredId,
        },
      })
    },
    onAreaSelectStart: ({ startPoint, mouseEvent }) => {
      if ((mouseEvent.buttons & 1) === 0) {
        return
      }

      const scaledStartPoint = startPoint.threeD
        .clone()
        .multiplyScalar(context.sceneInfra.baseUnitMultiplier)
      updateSelectionBox({
        startPoint3D: scaledStartPoint,
        currentPoint3D: scaledStartPoint,
        sceneInfra: context.sceneInfra,
        selectionBoxState: context.selectionBoxState,
      })
      sendDuringAreaSelectionToParent(self, [])
    },
    onAreaSelect: ({ startPoint, currentPoint, mouseEvent }) => {
      if ((mouseEvent.buttons & 1) === 0) {
        return
      }

      const scaledStartPoint = startPoint.threeD
        .clone()
        .multiplyScalar(context.sceneInfra.baseUnitMultiplier)
      const scaledCurrentPoint = currentPoint.threeD
        .clone()
        .multiplyScalar(context.sceneInfra.baseUnitMultiplier)

      updateSelectionBox({
        startPoint3D: scaledStartPoint,
        currentPoint3D: scaledCurrentPoint,
        sceneInfra: context.sceneInfra,
        selectionBoxState: context.selectionBoxState,
      })

      const parentData = getParentSketchData(self)
      if (!parentData) {
        return
      }

      const camera = context.sceneInfra.camControls.camera
      const renderer = context.sceneInfra.renderer
      const viewportSize = new Vector2(
        renderer.domElement.clientWidth,
        renderer.domElement.clientHeight
      )
      const startPx = project3DToScreen(scaledStartPoint, camera, viewportSize)
      const currentPx = project3DToScreen(
        scaledCurrentPoint,
        camera,
        viewportSize
      )
      const isIntersectionBox = isIntersectionSelectionMode(startPx, currentPx)

      const candidateSelectionIds = getAreaSelectionIds({
        startPoint: [startPoint.twoD.x, startPoint.twoD.y],
        currentPoint: [currentPoint.twoD.x, currentPoint.twoD.y],
        isIntersectionBox,
        objects: parentData.objects,
        sketchId: parentData.sketchId,
      })

      self.send({
        type: 'preview area selection',
        currentSelectionIds: parentData.selectedIds,
        candidateSelectionIds,
        objects: parentData.objects,
      })
    },
    onAreaSelectEnd: ({ startPoint, currentPoint, mouseEvent }) => {
      removeSelectionBox(context.selectionBoxState)

      if (mouseEvent.button !== 0) {
        sendDuringAreaSelectionToParent(self, [])
        return
      }

      const parentData = getParentSketchData(self)
      if (!parentData) {
        sendDuringAreaSelectionToParent(self, [])
        return
      }

      const scaledStartPoint = startPoint.threeD
        .clone()
        .multiplyScalar(context.sceneInfra.baseUnitMultiplier)
      const scaledCurrentPoint = currentPoint.threeD
        .clone()
        .multiplyScalar(context.sceneInfra.baseUnitMultiplier)
      const camera = context.sceneInfra.camControls.camera
      const renderer = context.sceneInfra.renderer
      const viewportSize = new Vector2(
        renderer.domElement.clientWidth,
        renderer.domElement.clientHeight
      )
      const startPx = project3DToScreen(scaledStartPoint, camera, viewportSize)
      const currentPx = project3DToScreen(
        scaledCurrentPoint,
        camera,
        viewportSize
      )
      const isIntersectionBox = isIntersectionSelectionMode(startPx, currentPx)
      const candidateSelectionIds = getAreaSelectionIds({
        startPoint: [startPoint.twoD.x, startPoint.twoD.y],
        currentPoint: [currentPoint.twoD.x, currentPoint.twoD.y],
        isIntersectionBox,
        objects: parentData.objects,
        sketchId: parentData.sketchId,
      })

      self.send({
        type: 'commit area selection',
        currentSelectionIds: parentData.selectedIds,
        candidateSelectionIds,
        objects: parentData.objects,
      })
    },
  })
}

function maybeSyncCurrentSelectionFromParent({
  context,
  self,
}: {
  context: ConstraintToolContext
  self: {
    send: (event: ConstraintToolEvent) => void
    _parent?: {
      getSnapshot?: () => unknown
    }
  }
}) {
  if (context.didInitialSelectionSync) {
    return
  }

  queueMicrotask(() => {
    syncCurrentSelectionFromParent({ self })
  })
}

function removeConstraintToolListener({
  context,
  self,
}: {
  context: ConstraintToolContext
  self: {
    _parent?: {
      send?: (event: ParentSketchSolveEvent) => void
    }
  }
}) {
  context.sceneInfra.setCallbacks({
    onClick: () => {},
    onMove: () => {},
    onAreaSelectStart: () => {},
    onAreaSelect: () => {},
    onAreaSelectEnd: () => {},
  })
  removeSelectionBox(context.selectionBoxState)
  sendDuringAreaSelectionToParent(self, [])

  self._parent?.send?.({
    type: 'update hovered id',
    data: {
      hoveredId: null,
    },
  })
}

function getNormalizedSelection(
  toolName: ConstraintToolName,
  selectionIds: SketchSolveSelectionId[],
  objects: ApiObject[]
) {
  return normalizeConstraintToolSelection(toolName, selectionIds, objects)
}

function getPreparedApplyFromClick({
  toolName,
  currentSelectionIds,
  clickedSelectionId,
  objects,
  defaultLengthUnit,
}: {
  toolName: ConstraintToolName
  currentSelectionIds: SketchSolveSelectionId[]
  clickedSelectionId: SketchSolveSelectionId | null
  objects: ApiObject[]
  defaultLengthUnit: NumericSuffix
}) {
  return resolveConstraintToolClickAction(
    toolName,
    currentSelectionIds,
    clickedSelectionId,
    objects,
    { defaultLengthUnit }
  )
}

function getSelectionActionFromCandidates({
  toolName,
  currentSelectionIds,
  candidateSelectionIds,
  objects,
  defaultLengthUnit,
}: {
  toolName: ConstraintToolName
  currentSelectionIds: SketchSolveSelectionId[]
  candidateSelectionIds: SketchSolveSelectionId[]
  objects: ApiObject[]
  defaultLengthUnit: NumericSuffix
}) {
  return resolveConstraintToolSelectionAction(
    toolName,
    currentSelectionIds,
    candidateSelectionIds,
    objects,
    { defaultLengthUnit }
  )
}

function getPreviewSelectionIds(
  selectionAction: ConstraintToolSelectionAction
): SketchSolveSelectionId[] {
  if (selectionAction.type === 'apply') {
    return selectionAction.apply.selectionIds
  }

  if (selectionAction.type === 'select') {
    return selectionAction.nextSelectionIds
  }

  return []
}

export function createConstraintToolMachine({
  toolName,
  toolId,
}: {
  toolName: ConstraintToolName
  toolId: string
}) {
  return setup({
    types: {
      context: constraintToolContextType,
      events: constraintToolEventType,
      input: constraintToolInputType,
    },
    guards: {
      'normalized selection can apply': ({ event, context }) => {
        assertEvent(event, 'normalize selection')
        const normalized = getNormalizedSelection(
          context.toolName,
          event.selectionIds,
          event.objects
        )
        return (
          getConstraintToolPreparedApply(
            context.toolName,
            normalized.selectionIds,
            event.objects,
            {
              defaultLengthUnit: getDefaultLengthUnit(context.kclManager),
            }
          ) !== null
        )
      },
      'clicked selection can apply': ({ event, context }) => {
        assertEvent(event, 'click selection')
        return (
          getPreparedApplyFromClick({
            toolName: context.toolName,
            currentSelectionIds: event.currentSelectionIds,
            clickedSelectionId: event.clickedSelectionId,
            objects: event.objects,
            defaultLengthUnit: getDefaultLengthUnit(context.kclManager),
          }).type === 'apply'
        )
      },
    },
    actions: {
      'add constraint tool listener': addConstraintToolListener,
      'maybe sync current selection from parent':
        maybeSyncCurrentSelectionFromParent,
      'mark initial selection synced': assign({
        didInitialSelectionSync: true,
      }),
      'remove constraint tool listener': removeConstraintToolListener,
      'normalize selection in parent': ({ event, context, self }) => {
        assertEvent(event, 'normalize selection')
        const normalized = getNormalizedSelection(
          context.toolName,
          event.selectionIds,
          event.objects
        )
        sendSelectionToParent(self, normalized.selectionIds)
      },
      'resolve click selection in parent': ({ event, context, self }) => {
        assertEvent(event, 'click selection')
        const clickAction = getPreparedApplyFromClick({
          toolName: context.toolName,
          currentSelectionIds: event.currentSelectionIds,
          clickedSelectionId: event.clickedSelectionId,
          objects: event.objects,
          defaultLengthUnit: getDefaultLengthUnit(context.kclManager),
        })

        if (clickAction.type === 'clear') {
          sendSelectionToParent(self, [])
          return
        }

        if (clickAction.type === 'select') {
          sendSelectionToParent(self, clickAction.nextSelectionIds)
        }
      },
      'store pending apply from normalized selection': assign(
        ({ event, context }) => {
          assertEvent(event, 'normalize selection')
          const normalized = getNormalizedSelection(
            context.toolName,
            event.selectionIds,
            event.objects
          )
          return {
            pendingApply:
              getConstraintToolPreparedApply(
                context.toolName,
                normalized.selectionIds,
                event.objects,
                {
                  defaultLengthUnit: getDefaultLengthUnit(context.kclManager),
                }
              ) ?? undefined,
          }
        }
      ),
      'store pending apply from clicked selection': assign(
        ({ event, context }) => {
          assertEvent(event, 'click selection')
          const clickAction = getPreparedApplyFromClick({
            toolName: context.toolName,
            currentSelectionIds: event.currentSelectionIds,
            clickedSelectionId: event.clickedSelectionId,
            objects: event.objects,
            defaultLengthUnit: getDefaultLengthUnit(context.kclManager),
          })

          return {
            pendingApply:
              clickAction.type === 'apply' ? clickAction.apply : undefined,
          }
        }
      ),
      'preview area selection in parent': ({ event, context, self }) => {
        assertEvent(event, 'preview area selection')
        const selectionAction = getSelectionActionFromCandidates({
          toolName: context.toolName,
          currentSelectionIds: event.currentSelectionIds,
          candidateSelectionIds: event.candidateSelectionIds,
          objects: event.objects,
          defaultLengthUnit: getDefaultLengthUnit(context.kclManager),
        })
        const previewSelectionIds = getPreviewSelectionIds(selectionAction)
        const previewIds = previewSelectionIds
          .filter(
            (selectionId): selectionId is number =>
              typeof selectionId === 'number'
          )
          .filter(
            (selectionId) => !event.currentSelectionIds.includes(selectionId)
          )

        sendDuringAreaSelectionToParent(self, previewIds)
      },
      'resolve committed area selection in parent': ({
        event,
        context,
        self,
      }) => {
        assertEvent(event, 'commit area selection')
        const selectionAction = getSelectionActionFromCandidates({
          toolName: context.toolName,
          currentSelectionIds: event.currentSelectionIds,
          candidateSelectionIds: event.candidateSelectionIds,
          objects: event.objects,
          defaultLengthUnit: getDefaultLengthUnit(context.kclManager),
        })

        sendDuringAreaSelectionToParent(self, [])

        if (selectionAction.type === 'clear') {
          sendSelectionToParent(self, [])
          return
        }

        if (selectionAction.type === 'select') {
          sendSelectionToParent(self, selectionAction.nextSelectionIds)
        }
      },
      'store pending apply from committed area selection': assign(
        ({ event, context }) => {
          assertEvent(event, 'commit area selection')
          const selectionAction = getSelectionActionFromCandidates({
            toolName: context.toolName,
            currentSelectionIds: event.currentSelectionIds,
            candidateSelectionIds: event.candidateSelectionIds,
            objects: event.objects,
            defaultLengthUnit: getDefaultLengthUnit(context.kclManager),
          })

          return {
            pendingApply:
              selectionAction.type === 'apply'
                ? selectionAction.apply
                : undefined,
          }
        }
      ),
      'clear pending apply': assign({
        pendingApply: undefined,
      }),
      'clear selection in parent': ({ self }) => {
        sendSelectionToParent(self, [])
      },
      'restore attempted selection in parent': ({ context, self }) => {
        sendSelectionToParent(self, context.pendingApply?.selectionIds ?? [])
      },
      'toast sketch solve error': ({ event }) => {
        toastSketchSolveError(event)
      },
    },
    actors: {
      applyConstraint: fromPromise(
        async ({
          input,
        }: {
          input: {
            pendingApply: ConstraintToolPreparedApply
            rustContext: RustContext
            sketchId: number
          }
        }) => {
          const settings = jsAppSettings(input.rustContext.settingsActor)
          let latestResult: ConstraintToolApplyResult | undefined

          for (const [
            index,
            payload,
          ] of input.pendingApply.payloads.entries()) {
            latestResult = await input.rustContext.addConstraint(
              0,
              input.sketchId,
              payload,
              settings,
              index === input.pendingApply.payloads.length - 1
            )
          }

          if (!latestResult) {
            return Promise.reject(
              new Error('No constraint payloads were prepared for apply')
            )
          }

          return latestResult
        }
      ),
    },
  }).createMachine({
    context: ({ input }): ConstraintToolContext => ({
      sceneInfra: input.sceneInfra,
      rustContext: input.rustContext,
      kclManager: input.kclManager,
      sketchId: input.sketchId,
      toolName,
      didInitialSelectionSync: false,
      selectionBoxState: createSelectionBoxVisualState(),
    }),
    id: toolId,
    initial: 'active',
    on: {
      unequip: {
        target: `#${toolId}.unequipping`,
      },
      escape: {
        target: `#${toolId}.unequipping`,
      },
    },
    states: {
      active: {
        entry: [
          'add constraint tool listener',
          'maybe sync current selection from parent',
          'mark initial selection synced',
        ],
        exit: 'remove constraint tool listener',
        on: {
          'normalize selection': [
            {
              guard: 'normalized selection can apply',
              target: 'applying',
              actions: 'store pending apply from normalized selection',
            },
            {
              actions: 'normalize selection in parent',
            },
          ],
          'click selection': [
            {
              guard: 'clicked selection can apply',
              target: 'applying',
              actions: 'store pending apply from clicked selection',
            },
            {
              actions: 'resolve click selection in parent',
            },
          ],
          'preview area selection': {
            actions: 'preview area selection in parent',
          },
          'commit area selection': [
            {
              guard: ({ event, context }) => {
                assertEvent(event, 'commit area selection')
                return (
                  getSelectionActionFromCandidates({
                    toolName: context.toolName,
                    currentSelectionIds: event.currentSelectionIds,
                    candidateSelectionIds: event.candidateSelectionIds,
                    objects: event.objects,
                    defaultLengthUnit: getDefaultLengthUnit(context.kclManager),
                  }).type === 'apply'
                )
              },
              target: 'applying',
              actions: 'store pending apply from committed area selection',
            },
            {
              actions: 'resolve committed area selection in parent',
            },
          ],
        },
      },
      applying: {
        invoke: {
          src: 'applyConstraint',
          input: ({ context }) => ({
            pendingApply: context.pendingApply!,
            rustContext: context.rustContext,
            sketchId: context.sketchId,
          }),
          onDone: {
            target: 'active',
            actions: [
              'clear selection in parent',
              ({ event, self }) => {
                self._parent?.send?.({
                  type: 'update sketch outcome',
                  data: {
                    sourceDelta: event.output.kclSource,
                    sceneGraphDelta: event.output.sceneGraphDelta,
                    checkpointId: event.output.checkpointId ?? null,
                  },
                })
              },
              'clear pending apply',
            ],
          },
          onError: {
            target: 'active',
            actions: [
              'restore attempted selection in parent',
              'clear pending apply',
              'toast sketch solve error',
            ],
          },
        },
      },
      unequipping: {
        type: 'final',
        entry: 'remove constraint tool listener',
      },
    },
  })
}
