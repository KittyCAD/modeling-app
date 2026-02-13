import { KclInput } from '@src/components/KclInput'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useSingletons } from '@src/lib/boot'
import { SKETCH_FILE_VERSION } from '@src/lib/constants'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import type { modelingMachine } from '@src/machines/modelingMachine'
import {
  calculateDimensionLabelScreenPosition,
  getConstraintObject,
  isDistanceConstraint,
} from '@src/machines/sketchSolve/constraints'
import type { sketchSolveMachine } from '@src/machines/sketchSolve/sketchSolveDiagram'
import { useSelector } from '@xstate/react'
import { useCallback, useEffect, useState } from 'react'
import type { SnapshotFrom, StateFrom } from 'xstate'

export const EditingConstraintInput = () => {
  const { sceneInfra, rustContext } = useSingletons()
  const { state } = useModelingContext()
  const editingConstraintId = useSelector(
    state.children.sketchSolveMachine,
    (snapshot) =>
      isSketchSolveSnapshot(snapshot)
        ? snapshot.context.editingConstraintId
        : undefined
  )

  const [position, setPosition] = useState<[number, number]>(() => {
    return (
      (editingConstraintId &&
        calculateDimensionLabelScreenPosition(
          editingConstraintId,
          state,
          sceneInfra
        )) || [0, 0]
    )
  })

  useEffect(() => {
    if (editingConstraintId === undefined) return

    const updatePosition = () => {
      const pos = calculateDimensionLabelScreenPosition(
        editingConstraintId,
        state,
        sceneInfra
      )
      if (pos) {
        setPosition(pos)
      }
    }

    updatePosition()
    // If camera changes, label position might change so need to update
    const removeListener =
      sceneInfra.camControls.cameraChange.add(updatePosition)

    // Stop listening when editingConstraintId becomes undefined (we're no longer editing) and on unmount
    return removeListener
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingConstraintId])

  const sketchSolveActor = state.children.sketchSolveMachine

  const onEditSubmit = useCallback(
    async (value: string) => {
      sketchSolveActor?.send({ type: 'stop editing constraint' })

      try {
        const snapshot = sketchSolveActor?.getSnapshot()
        const sketchId = isSketchSolveSnapshot(snapshot)
          ? snapshot.context.sketchId
          : 0
        const result = await rustContext.editConstraint(
          SKETCH_FILE_VERSION,
          sketchId,
          editingConstraintId!,
          value,
          await jsAppSettings(rustContext.settingsActor)
        )
        if (result) {
          sketchSolveActor?.send({
            type: 'update sketch outcome',
            data: {
              sourceDelta: result.kclSource,
              sceneGraphDelta: result.sceneGraphDelta,
            },
          })
        }
      } catch (e) {
        console.error('Failed to edit constraint:', e)
      }
    },
    [sketchSolveActor, rustContext, editingConstraintId]
  )

  const onEditCancel = useCallback(() => {
    sketchSolveActor?.send({ type: 'stop editing constraint' })
  }, [sketchSolveActor])

  return editingConstraintId !== undefined ? (
    <KclInput
      initialValue={getInitialDimension(editingConstraintId, state)}
      x={position[0]}
      y={position[1]}
      onSubmit={onEditSubmit}
      onCancel={onEditCancel}
    />
  ) : null
}

function isSketchSolveSnapshot(
  snapshot: unknown
): snapshot is SnapshotFrom<typeof sketchSolveMachine> {
  return !!(
    snapshot &&
    typeof snapshot === 'object' &&
    'context' in snapshot &&
    snapshot.context &&
    typeof snapshot.context === 'object' &&
    'editingConstraintId' in snapshot.context &&
    'sketchId' in snapshot.context
  )
}

function getInitialDimension(
  editingConstraintId: number,
  state: StateFrom<typeof modelingMachine>
) {
  let initialDimension = ''
  const constraintObject =
    editingConstraintId && getConstraintObject(editingConstraintId, state)
  if (constraintObject && isDistanceConstraint(constraintObject.kind)) {
    initialDimension = constraintObject.kind.constraint.source.expr
  }
  return initialDimension
}
