import { CustomIcon } from '@src/components/CustomIcon'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { DEFAULT_DEFAULT_LENGTH_UNIT } from '@src/lib/constants'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import { reportRejection } from '@src/lib/trap'
import { uuidv4 } from '@src/lib/utils'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type DistanceMode,
  distanceModes,
  formatDistance,
  getDistanceTypeForMode,
  getMeasurementEntityIds,
} from './measurementUtils'

type MeasurementStatus = 'idle' | 'measuring'

type MeasurementResult = {
  min: number
  max: number
  entityIdsKey: string
  mode: DistanceMode
}

function getResponseErrorMessage(response: unknown): string {
  if (response instanceof Error) {
    return response.message
  }

  if (Array.isArray(response)) {
    const errorMessage = response.find(
      (item) => typeof item?.errors?.[0]?.message === 'string'
    )?.errors?.[0]?.message
    if (errorMessage) {
      return errorMessage
    }
  }

  return 'Measurement failed'
}

function MeasurementValue({
  label,
  value,
  unit,
}: {
  label: string
  value: number
  unit: string
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] leading-3 text-chalkboard-70 dark:text-chalkboard-40">
        {label}
      </div>
      <div className="truncate text-sm font-medium tabular-nums">
        {formatDistance(value)}
        <span className="ml-1 text-xs font-normal text-chalkboard-70 dark:text-chalkboard-40">
          {unit}
        </span>
      </div>
    </div>
  )
}

export function MeasurementTool() {
  const { state } = useModelingContext()
  const { engineCommandManager, kclManager, store } = state.context
  const [distanceMode, setDistanceMode] = useState<DistanceMode>('euclidean')
  const [status, setStatus] = useState<MeasurementStatus>('idle')
  const [result, setResult] = useState<MeasurementResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const latestRequestKey = useRef<string | null>(null)

  const selectedEntityIds = useMemo(
    () => getMeasurementEntityIds(state.context.selectionRanges),
    [state.context.selectionRanges]
  )
  const selectedEntityIdsKey = selectedEntityIds.join(':')
  const measurementInputKey = `${selectedEntityIdsKey}:${distanceMode}`
  const canMeasure = selectedEntityIds.length === 2
  const unit =
    kclManager.fileSettings.defaultLengthUnit ??
    store.defaultUnit?.current ??
    DEFAULT_DEFAULT_LENGTH_UNIT

  useEffect(() => {
    latestRequestKey.current = measurementInputKey
    setStatus('idle')
    setResult(null)
    setErrorMessage(null)
  }, [measurementInputKey])

  const measureDistance = useCallback(() => {
    if (!canMeasure) {
      return
    }

    const [entityId1, entityId2] = selectedEntityIds
    const requestKey = `${selectedEntityIdsKey}:${distanceMode}:${uuidv4()}`
    latestRequestKey.current = requestKey
    setStatus('measuring')
    setErrorMessage(null)

    engineCommandManager
      .sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'entity_get_distance',
          entity_id1: entityId1,
          entity_id2: entityId2,
          distance_type: getDistanceTypeForMode(distanceMode),
        },
      })
      .then((response) => {
        if (latestRequestKey.current !== requestKey) {
          return
        }

        if (!isModelingResponse(response)) {
          setErrorMessage(getResponseErrorMessage(response))
          return
        }

        const modelingResponse = response.resp.data.modeling_response
        if (modelingResponse.type !== 'entity_get_distance') {
          setErrorMessage('Measurement failed')
          return
        }

        setResult({
          min: modelingResponse.data.min_distance,
          max: modelingResponse.data.max_distance,
          entityIdsKey: selectedEntityIdsKey,
          mode: distanceMode,
        })
      })
      .catch((error) => {
        if (latestRequestKey.current === requestKey) {
          setErrorMessage(getResponseErrorMessage(error))
        }
        reportRejection(error)
      })
      .finally(() => {
        if (latestRequestKey.current === requestKey) {
          setStatus('idle')
        }
      })
  }, [
    canMeasure,
    distanceMode,
    engineCommandManager,
    selectedEntityIds,
    selectedEntityIdsKey,
  ])

  if (!state.matches('idle')) {
    return null
  }

  const hasRange =
    result &&
    result.entityIdsKey === selectedEntityIdsKey &&
    result.mode === distanceMode &&
    Math.abs(result.max - result.min) > 1e-9

  return (
    <div className="absolute bottom-2 left-2 z-10 flex max-w-[calc(100%-1rem)] items-end gap-2 pointer-events-auto">
      <div className="flex min-w-56 max-w-80 flex-col gap-2 rounded border border-chalkboard-20 bg-chalkboard-10/85 p-2 text-chalkboard-100 shadow-lg backdrop-blur-sm dark:border-chalkboard-80 dark:bg-chalkboard-100/85 dark:text-chalkboard-10">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <CustomIcon
              name="dimension"
              className="h-4 w-4 shrink-0 text-chalkboard-70 dark:text-chalkboard-40"
            />
            <span className="truncate text-xs font-medium">Measure</span>
          </div>
          <span className="rounded bg-chalkboard-20 px-1.5 py-0.5 text-[10px] leading-3 tabular-nums text-chalkboard-70 dark:bg-chalkboard-90 dark:text-chalkboard-30">
            {selectedEntityIds.length} / 2
          </span>
        </div>

        <fieldset className="m-0 grid grid-cols-4 rounded border border-chalkboard-20 bg-chalkboard-10 p-0 dark:border-chalkboard-80 dark:bg-chalkboard-90">
          <legend className="sr-only">Measurement distance type</legend>
          {distanceModes.map((mode) => {
            const isActive = distanceMode === mode.value
            return (
              <button
                key={mode.value}
                type="button"
                aria-pressed={isActive}
                title={
                  mode.value === 'euclidean'
                    ? 'Euclidean distance'
                    : `${mode.label} axis distance`
                }
                onClick={() => setDistanceMode(mode.value)}
                className={`m-0 h-7 border-0 border-r border-solid border-chalkboard-20 px-2 text-xs last:border-r-0 dark:border-chalkboard-80 ${
                  isActive
                    ? 'bg-primary text-chalkboard-10'
                    : 'bg-transparent text-chalkboard-90 hover:bg-chalkboard-20 dark:text-chalkboard-20 dark:hover:bg-chalkboard-80'
                }`}
              >
                {mode.label}
              </button>
            )
          })}
        </fieldset>

        <button
          type="button"
          disabled={!canMeasure || status === 'measuring'}
          title={
            canMeasure
              ? 'Measure distance'
              : 'Select two scene entities to measure'
          }
          onClick={measureDistance}
          className="m-0 flex h-8 items-center justify-center gap-1.5 rounded border border-primary bg-primary px-2 text-xs font-medium text-chalkboard-10 disabled:cursor-not-allowed disabled:border-chalkboard-30 disabled:bg-chalkboard-20 disabled:text-chalkboard-60 dark:disabled:border-chalkboard-80 dark:disabled:bg-chalkboard-90 dark:disabled:text-chalkboard-50"
        >
          <CustomIcon name="dimension" className="h-4 w-4" />
          {status === 'measuring' ? 'Measuring' : 'Measure'}
        </button>

        {result &&
          result.entityIdsKey === selectedEntityIdsKey &&
          result.mode === distanceMode && (
            <div className="grid grid-cols-2 gap-3 border-t border-chalkboard-20 pt-2 dark:border-chalkboard-80">
              <MeasurementValue
                label={hasRange ? 'Min' : 'Distance'}
                value={result.min}
                unit={unit}
              />
              {hasRange && (
                <MeasurementValue label="Max" value={result.max} unit={unit} />
              )}
            </div>
          )}

        {errorMessage && (
          <div className="truncate border-t border-chalkboard-20 pt-2 text-xs text-destroy-80 dark:border-chalkboard-80">
            {errorMessage}
          </div>
        )}
      </div>
    </div>
  )
}
