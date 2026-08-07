import type { ModelingCmd, Point3d } from '@kittycad/lib'
import { useSignals } from '@preact/signals-react/runtime'
import { CustomIcon } from '@src/components/CustomIcon'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { uuidv4 } from '@src/lib/utils'
import {
  getMeasurementEntities,
  type MeasurementEntity,
} from '@src/registry/extensions/engineScene/measurementUtils'
import { useCallback, useMemo, useState } from 'react'

type DrawingProjectionDebugStatus = 'idle' | 'sending' | 'success' | 'error'

type DrawingProjectionFrame = {
  origin: Point3d
  x_axis: Point3d
  y_axis: Point3d
}

export type ComputeDrawingProjectionDebugCommand = {
  type: 'compute_drawing_projection'
  object_id: string
  frame: DrawingProjectionFrame
  hidden_lines: 'include_hidden'
  resolution: number
  tolerance: number
}

const DEFAULT_DRAWING_PROJECTION_FRAME: DrawingProjectionFrame = {
  origin: { x: 0, y: 0, z: 0 },
  x_axis: { x: 1, y: 0, z: 0 },
  y_axis: { x: 0, y: 1, z: 0 },
}

const DEFAULT_DRAWING_PROJECTION_RESOLUTION = 19
const DEFAULT_DRAWING_PROJECTION_TOLERANCE = 0.00001

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2)
}

export function createComputeDrawingProjectionDebugCommand(
  objectId: string
): ComputeDrawingProjectionDebugCommand {
  return {
    type: 'compute_drawing_projection',
    object_id: objectId,
    frame: DEFAULT_DRAWING_PROJECTION_FRAME,
    hidden_lines: 'include_hidden',
    resolution: DEFAULT_DRAWING_PROJECTION_RESOLUTION,
    tolerance: DEFAULT_DRAWING_PROJECTION_TOLERANCE,
  }
}

export function getSingleSelectedBody(
  selectedEntities: MeasurementEntity[]
): MeasurementEntity | null {
  if (selectedEntities.length !== 1) {
    return null
  }

  const [selectedEntity] = selectedEntities
  return selectedEntity.kind === 'body' ? selectedEntity : null
}

function stringifyError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function DrawingProjectionDebugPane() {
  useSignals()
  const { state } = useModelingContext()
  const { engineCommandManager } = state.context
  const [status, setStatus] = useState<DrawingProjectionDebugStatus>('idle')
  const [lastResponse, setLastResponse] = useState<unknown>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const selectedEntities = useMemo(
    () => getMeasurementEntities(state.context.selectionRanges),
    [state.context.selectionRanges]
  )
  const selectedBody = useMemo(
    () => getSingleSelectedBody(selectedEntities),
    [selectedEntities]
  )
  const commandInput = useMemo(
    () =>
      selectedBody
        ? createComputeDrawingProjectionDebugCommand(selectedBody.id)
        : null,
    [selectedBody]
  )

  const sendProjectionCommand = useCallback(async () => {
    if (!commandInput) {
      return
    }

    setStatus('sending')
    setErrorMessage(null)

    try {
      const response = await engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: commandInput as unknown as ModelingCmd,
      })
      setLastResponse(response)
      setStatus('success')
    } catch (error) {
      setErrorMessage(stringifyError(error))
      setStatus('error')
    }
  }, [commandInput, engineCommandManager])

  return (
    <div className="flex h-full min-w-80 flex-col gap-3 overflow-auto bg-chalkboard-10 p-3 text-chalkboard-90 dark:bg-chalkboard-100 dark:text-chalkboard-10">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-sm font-semibold">Projection Debug</h2>
        <span
          data-testid="drawing-projection-debug-status"
          className="rounded-sm border border-chalkboard-30 px-2 py-0.5 text-xs uppercase text-chalkboard-70 dark:border-chalkboard-80 dark:text-chalkboard-40"
        >
          {status === 'success' ? 'OK' : status}
        </span>
      </div>

      <div className="text-xs text-chalkboard-70 dark:text-chalkboard-40">
        {selectedBody
          ? `Selected body: ${selectedBody.id}`
          : 'Select one body to send a projection request.'}
      </div>

      <button
        type="button"
        data-testid="drawing-projection-debug-send"
        className="flex h-8 w-fit items-center gap-1 rounded-sm border border-primary bg-primary px-2 text-xs font-medium text-chalkboard-10 disabled:cursor-not-allowed disabled:border-chalkboard-30 disabled:bg-chalkboard-20 disabled:text-chalkboard-60 dark:disabled:border-chalkboard-80 dark:disabled:bg-chalkboard-90 dark:disabled:text-chalkboard-50"
        disabled={!commandInput || status === 'sending'}
        onClick={sendProjectionCommand}
      >
        <CustomIcon name="arrowRight" className="h-4 w-4" aria-hidden />
        Send
      </button>

      {errorMessage && (
        <pre
          data-testid="drawing-projection-debug-error"
          className="m-0 whitespace-pre-wrap break-words border-t border-destroy-40 pt-2 text-xs text-destroy-80"
        >
          {errorMessage}
        </pre>
      )}

      <section className="flex min-h-0 flex-1 flex-col gap-2">
        <h3 className="m-0 text-xs font-semibold uppercase text-chalkboard-60 dark:text-chalkboard-40">
          Input
        </h3>
        <pre
          data-testid="drawing-projection-debug-input"
          className="m-0 min-h-40 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-sm border border-chalkboard-30 bg-chalkboard-10 p-2 text-xs dark:border-chalkboard-80 dark:bg-chalkboard-90"
        >
          {formatJson(commandInput)}
        </pre>
      </section>

      <section className="flex min-h-0 flex-1 flex-col gap-2">
        <h3 className="m-0 text-xs font-semibold uppercase text-chalkboard-60 dark:text-chalkboard-40">
          Output
        </h3>
        <pre
          data-testid="drawing-projection-debug-output"
          className="m-0 min-h-40 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-sm border border-chalkboard-30 bg-chalkboard-10 p-2 text-xs dark:border-chalkboard-80 dark:bg-chalkboard-90"
        >
          {formatJson(lastResponse)}
        </pre>
      </section>
    </div>
  )
}
