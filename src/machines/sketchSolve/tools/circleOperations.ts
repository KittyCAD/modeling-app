import type {
  SceneGraphDelta,
  SegmentCtor,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { Coords2d } from '@src/lang/util'
import { baseUnitToNumericSuffix } from '@src/lang/wasm'
import type RustContext from '@src/lib/rustContext'
import type { KclSettingsAnnotation } from '@src/lib/settings/settingsTypes'
import { roundOff } from '@src/lib/utils'
import { isCircleSegment } from '@src/machines/sketchSolve/constraints/constraintUtils'
import {
  type SnapTarget,
  applyConstraintsForSnapTarget,
} from '@src/machines/sketchSolve/snapping'
import { MIN_DRAFT_GEOMETRY_DELTA_MM } from '@src/machines/sketchSolve/tools/draftGeometryPolicy'

/** The circle algorithm borrows sketch mutations and unit settings from its owning session. */
export type CircleRuntime = Pick<
  RustContext,
  'addSegment' | 'editSegments' | 'addConstraint' | 'prepareForSketchInsertion'
> & {
  getSettings: () => Parameters<RustContext['addSegment']>[4]
}
export type CircleGeometryInput = {
  centerPoint: Coords2d
  startPoint: Coords2d
  rustContext: CircleRuntime
  lengthUnit: KclSettingsAnnotation['defaultLengthUnit']
  sketchId: number
}

export type CircleResult = {
  kclSource: SourceDelta
  sceneGraphDelta: SceneGraphDelta
  checkpointId?: number | null
}

type DraftCircleInput = Omit<CircleGeometryInput, 'startPoint'> & {
  centerSnapTarget?: SnapTarget
}

type CircleUpdateInput = CircleGeometryInput & { circleId: number }

function circleSegment(input: CircleGeometryInput): SegmentCtor {
  const units = baseUnitToNumericSuffix(input.lengthUnit)
  return {
    type: 'Circle',
    center: {
      x: { type: 'Var', value: roundOff(input.centerPoint[0]), units },
      y: { type: 'Var', value: roundOff(input.centerPoint[1]), units },
    },
    start: {
      x: { type: 'Var', value: roundOff(input.startPoint[0]), units },
      y: { type: 'Var', value: roundOff(input.startPoint[1]), units },
    },
  }
}

export async function createDraftCircle({
  input,
}: {
  input: DraftCircleInput | { error: string }
}) {
  if ('error' in input) return input
  const result = await createOrUpdateCircle({
    ...input,
    startPoint: [
      input.centerPoint[0] + MIN_DRAFT_GEOMETRY_DELTA_MM,
      input.centerPoint[1],
    ],
    createCheckpoint: false,
  })
  if ('error' in result) return result
  const circleId = result.sceneGraphDelta.new_objects.find((id) =>
    isCircleSegment(result.sceneGraphDelta.new_graph.objects[id])
  )
  if (circleId === undefined)
    return { error: 'The draft circle was not created.' }
  return {
    ...result,
    draft: {
      circleId,
      segmentIds: result.sceneGraphDelta.new_objects.filter(
        (id) =>
          result.sceneGraphDelta.new_graph.objects[id]?.kind.type === 'Segment'
      ),
      constraintIds: result.sceneGraphDelta.new_objects.filter(
        (id) =>
          result.sceneGraphDelta.new_graph.objects[id]?.kind.type ===
          'Constraint'
      ),
    },
  }
}

export function updateDraftCircle(
  input: CircleUpdateInput
): Promise<CircleResult> {
  return input.rustContext.editSegments(
    0,
    input.sketchId,
    [{ id: input.circleId, ctor: circleSegment(input) }],
    input.rustContext.getSettings(),
    false
  )
}

export function commitCircle({
  input,
}: {
  input:
    | (CircleUpdateInput & { startSnapTarget?: SnapTarget })
    | { error: string }
}) {
  return createOrUpdateCircle(input)
}

async function createOrUpdateCircle(
  input:
    | (CircleGeometryInput & {
        circleId?: number
        createCheckpoint?: boolean
        centerSnapTarget?: SnapTarget
        startSnapTarget?: SnapTarget
      })
    | { error: string }
): Promise<CircleResult | { error: string }> {
  if ('error' in input) {
    return { error: input.error }
  }

  const {
    circleId,
    createCheckpoint = true,
    centerSnapTarget,
    startSnapTarget,
    rustContext,
    sketchId,
  } = input
  try {
    const segmentCtor = circleSegment(input)

    const settings = rustContext.getSettings()
    if (circleId === undefined) await rustContext.prepareForSketchInsertion()
    const result =
      circleId === undefined
        ? await rustContext.addSegment(
            0,
            sketchId,
            segmentCtor,
            'circle',
            settings,
            createCheckpoint
          )
        : await rustContext.editSegments(
            0,
            sketchId,
            [{ id: circleId, ctor: segmentCtor }],
            settings,
            createCheckpoint
          )

    const circleObjId =
      circleId ??
      result.sceneGraphDelta.new_objects.find((objId) => {
        const obj = result.sceneGraphDelta.new_graph.objects[objId]
        return isCircleSegment(obj)
      })
    if (circleObjId === undefined) {
      return result
    }

    const circleObj = result.sceneGraphDelta.new_graph.objects[circleObjId]
    if (!isCircleSegment(circleObj)) {
      return result
    }

    const snapTargets = [
      {
        segmentId: circleObj.kind.segment.center,
        snapTarget: centerSnapTarget,
      },
      {
        segmentId: circleObj.kind.segment.start,
        snapTarget: startSnapTarget,
      },
    ]

    let latestKclSource = result.kclSource
    let latestSceneGraphDelta = result.sceneGraphDelta
    let latestCheckpointId = result.checkpointId ?? null
    const snapConstraintNewObjects: number[] = []

    for (const { segmentId, snapTarget } of snapTargets) {
      const snapResult = await applyConstraintsForSnapTarget({
        segmentId,
        target: snapTarget,
        rustContext,
        sketchId,
        settings,
        createCheckpoint,
      })
      if (snapResult.result === null) {
        continue
      }

      latestKclSource = snapResult.result.kclSource
      latestSceneGraphDelta = snapResult.result.sceneGraphDelta
      latestCheckpointId = snapResult.result.checkpointId ?? latestCheckpointId
      snapConstraintNewObjects.push(...snapResult.newObjectIds)
    }

    if (snapConstraintNewObjects.length === 0) {
      return result
    }

    return {
      kclSource: latestKclSource,
      sceneGraphDelta: {
        ...latestSceneGraphDelta,
        new_objects: [
          ...result.sceneGraphDelta.new_objects,
          ...snapConstraintNewObjects,
        ],
      },
      checkpointId: latestCheckpointId,
    }
  } catch (error) {
    console.error('Failed to create circle:', error)
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
