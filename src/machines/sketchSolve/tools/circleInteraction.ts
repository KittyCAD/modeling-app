import type {
  OnClickCallbackArgs,
  SceneInfra,
} from '@src/clientSideScene/sceneInfra'
import { segmentUtilsMap } from '@src/machines/sketchSolve/segments'
import { getObjectIdForSnapTarget } from '@src/machines/sketchSolve/snapping'
import type { SketchSolveSelectionId } from '@src/machines/sketchSolve/sketchSolveSelection'
import {
  createCircleController,
  type CircleControllerHost,
  type CirclePoint,
} from '@src/machines/sketchSolve/tools/circleController'
import { updateToolSnappingPreview } from '@src/machines/sketchSolve/tools/toolSnappingUtils'
import type { SnappingCandidate } from '@src/machines/sketchSolve/snapping'
import type { Coords2d } from '@src/lang/util'

/** SceneInfra pointer and preview behavior is shared; hosts supply current geometry and native ownership. */
export function createCircleSceneInteraction(
  host: Omit<CircleControllerHost, 'feedback'> & {
    infra: SceneInfra
    pick: (
      position: Coords2d,
      event: MouseEvent,
      excluded: Iterable<number>
    ) => SnappingCandidate | null
    hover: (id: SketchSolveSelectionId | null) => void
    isCurrent: () => boolean
  }
) {
  const { infra } = host
  let candidate: SnappingCandidate | null = null
  const controller = createCircleController({
    ...host,
    feedback: (point, draft) => {
      const target = point ? candidate : null
      host.hover(
        target?.target.type === 'origin'
          ? 'origin'
          : getObjectIdForSnapTarget(target?.target)
      )
      updateToolSnappingPreview({ sceneInfra: infra, target })
      if (point && draft)
        segmentUtilsMap.ArcSegment.updatePreviewCircle({
          sceneInfra: infra,
          center: draft.center,
          radius: Math.hypot(
            point.position[0] - draft.center[0],
            point.position[1] - draft.center[1]
          ),
        })
      else segmentUtilsMap.ArcSegment.removePreviewCircle(infra)
    },
  })
  const pick = (
    args: Pick<OnClickCallbackArgs, 'intersectionPoint' | 'mouseEvent'>
  ): CirclePoint | undefined => {
    const point = args.intersectionPoint?.twoD
    if (!point) {
      candidate = null
      return
    }
    const position: Coords2d = [point.x, point.y]
    candidate = host.pick(
      position,
      args.mouseEvent,
      controller.getDraft()?.segmentIds ?? []
    )
    return {
      position: candidate?.position ?? position,
      snap: candidate?.target,
    }
  }
  infra.setCallbacks({
    onClick: (args) => {
      if (host.isCurrent() && args.mouseEvent.button === 0) {
        const point = pick(args)
        if (point) return controller.point(point)
      }
    },
    onMove: (args) => {
      if (host.isCurrent()) controller.move(pick(args))
    },
    onMouseDownSelection: () => false,
    onMouseLeave: () => controller.move(),
  })
  const element = infra.renderer?.domElement
  const previousCursor = element?.style.cursor
  if (element) element.style.cursor = 'crosshair'
  const leave = () => controller.move()
  element?.addEventListener('mouseleave', leave)
  let disposed = false
  return {
    ...controller,
    dispose: () => {
      if (!disposed) {
        disposed = true
        element?.removeEventListener('mouseleave', leave)
        if (element) element.style.cursor = previousCursor ?? ''
        infra.resetMouseListeners()
      }
      return controller.dispose()
    },
  }
}
