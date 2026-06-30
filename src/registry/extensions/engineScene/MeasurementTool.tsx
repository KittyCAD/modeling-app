import type {
  ModelingCmd,
  Point3d,
  UnitArea,
  UnitLength,
  UnitVolume,
} from '@kittycad/lib'
import { CustomIcon } from '@src/components/CustomIcon'
import { defaultStatusBarItemClassNames } from '@src/components/StatusBar/StatusBar'
import Tooltip from '@src/components/Tooltip'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { DEFAULT_DEFAULT_LENGTH_UNIT } from '@src/lib/constants'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import { reportRejection } from '@src/lib/trap'
import { isArray, uuidv4 } from '@src/lib/utils'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type DistanceMode,
  type MeasurementEntity,
  distanceModes,
  formatDistance,
  formatPoint3d,
  getAreaUnit,
  getDistanceTypeForMode,
  getMeasurementEntities,
  getVolumeUnit,
} from './measurementUtils'

type MeasurementStatus = 'idle' | 'measuring'

type MeasurementTarget =
  | { type: 'distance'; entityIds: [string, string] }
  | { type: 'edgeLength'; entity: MeasurementEntity }
  | { type: 'surfaceArea'; entity: MeasurementEntity }
  | { type: 'bodyDetails'; entity: MeasurementEntity }

type MeasurementResult =
  | {
      type: 'distance'
      min: number
      max: number
      entityIdsKey: string
      mode: DistanceMode
    }
  | {
      type: 'edgeLength'
      length: number
      entityIdsKey: string
      unit: UnitLength
    }
  | {
      type: 'surfaceArea'
      surfaceArea: number
      entityIdsKey: string
      unit: UnitArea
    }
  | {
      type: 'bodyDetails'
      volume: number
      volumeUnit: UnitVolume
      centerOfMass: Point3d
      centerOfMassUnit: UnitLength
      entityIdsKey: string
    }

type ModelingDataResult =
  | { type: 'data'; data: unknown }
  | { type: 'error'; error: Error }

type SendModelingCommand = (cmd: ModelingCmd) => Promise<unknown>

const defaultDistanceMode: DistanceMode = 'euclidean'

function getResponseErrorMessage(response: unknown): string {
  if (response instanceof Error) {
    return response.message
  }

  if (isArray(response)) {
    for (const item of response) {
      if (
        typeof item !== 'object' ||
        item === null ||
        !('errors' in item) ||
        !isArray(item.errors)
      ) {
        continue
      }

      const [firstError] = item.errors
      if (
        typeof firstError === 'object' &&
        firstError !== null &&
        'message' in firstError &&
        typeof firstError.message === 'string'
      ) {
        return firstError.message
      }
    }
  }

  return 'Measurement failed'
}

function getMeasurementTarget(
  selectedEntities: MeasurementEntity[]
): MeasurementTarget | null {
  if (selectedEntities.length === 2) {
    return {
      type: 'distance',
      entityIds: [selectedEntities[0].id, selectedEntities[1].id],
    }
  }

  if (selectedEntities.length !== 1) {
    return null
  }

  const [entity] = selectedEntities
  if (entity.kind === 'edge') {
    return { type: 'edgeLength', entity }
  }

  if (entity.kind === 'face') {
    return { type: 'surfaceArea', entity }
  }

  if (entity.kind === 'body') {
    return { type: 'bodyDetails', entity }
  }

  return null
}

function getMeasureButtonTitle(
  target: MeasurementTarget | null,
  selectedCount: number
): string {
  if (target?.type === 'distance') {
    return 'Measure distance'
  }

  if (target?.type === 'edgeLength') {
    return 'Measure edge length'
  }

  if (target?.type === 'surfaceArea') {
    return 'Measure surface area'
  }

  if (target?.type === 'bodyDetails') {
    return 'Measure body volume and center of mass'
  }

  if (selectedCount === 1) {
    return 'Selected entity cannot be measured'
  }

  return 'Select one measurable entity or two entities'
}

function getModelingData(
  response: unknown,
  expectedType: string
): ModelingDataResult {
  if (!isModelingResponse(response)) {
    return {
      type: 'error',
      error: new Error(getResponseErrorMessage(response)),
    }
  }

  const modelingResponse = response.resp.data.modeling_response
  if (modelingResponse.type !== expectedType || !('data' in modelingResponse)) {
    return { type: 'error', error: new Error('Measurement failed') }
  }

  return { type: 'data', data: modelingResponse.data }
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

function MeasurementPointValue({
  label,
  point,
  unit,
}: {
  label: string
  point: Point3d
  unit: UnitLength
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] leading-3 text-chalkboard-70 dark:text-chalkboard-40">
        {label}
      </div>
      <div className="truncate text-sm font-medium tabular-nums">
        {formatPoint3d(point)}
        <span className="ml-1 text-xs font-normal text-chalkboard-70 dark:text-chalkboard-40">
          {unit}
        </span>
      </div>
    </div>
  )
}

function resultMatchesSelection(
  result: MeasurementResult,
  entityIdsKey: string,
  distanceMode: DistanceMode
): boolean {
  if (result.entityIdsKey !== entityIdsKey) {
    return false
  }

  return result.type !== 'distance' || result.mode === distanceMode
}

async function requestMeasurement({
  targetForRequest,
  distanceMode,
  selectedEntityIdsKey,
  sendModelingCommand,
  unit,
  areaUnit,
  volumeUnit,
}: {
  targetForRequest: MeasurementTarget
  distanceMode: DistanceMode
  selectedEntityIdsKey: string
  sendModelingCommand: SendModelingCommand
  unit: UnitLength
  areaUnit: UnitArea
  volumeUnit: UnitVolume
}): Promise<MeasurementResult | Error> {
  if (targetForRequest.type === 'distance') {
    const [entityId1, entityId2] = targetForRequest.entityIds
    const modelingData = getModelingData(
      await sendModelingCommand({
        type: 'entity_get_distance',
        entity_id1: entityId1,
        entity_id2: entityId2,
        distance_type: getDistanceTypeForMode(distanceMode),
      }),
      'entity_get_distance'
    )
    if (modelingData.type === 'error') {
      return modelingData.error
    }
    const { data } = modelingData

    if (
      typeof data !== 'object' ||
      data === null ||
      !('min_distance' in data) ||
      !('max_distance' in data) ||
      typeof data.min_distance !== 'number' ||
      typeof data.max_distance !== 'number'
    ) {
      return new Error('Measurement failed')
    }

    return {
      type: 'distance',
      min: data.min_distance,
      max: data.max_distance,
      entityIdsKey: selectedEntityIdsKey,
      mode: distanceMode,
    }
  }

  if (targetForRequest.type === 'edgeLength') {
    const modelingData = getModelingData(
      await sendModelingCommand({
        type: 'edge_get_length',
        edge_id: targetForRequest.entity.id,
      }),
      'edge_get_length'
    )
    if (modelingData.type === 'error') {
      return modelingData.error
    }
    const { data } = modelingData

    if (
      typeof data !== 'object' ||
      data === null ||
      !('length' in data) ||
      typeof data.length !== 'number'
    ) {
      return new Error('Measurement failed')
    }

    return {
      type: 'edgeLength',
      length: data.length,
      entityIdsKey: selectedEntityIdsKey,
      unit,
    }
  }

  if (targetForRequest.type === 'surfaceArea') {
    const modelingData = getModelingData(
      await sendModelingCommand({
        type: 'surface_area',
        entity_ids: [targetForRequest.entity.id],
        output_unit: areaUnit,
      }),
      'surface_area'
    )
    if (modelingData.type === 'error') {
      return modelingData.error
    }
    const { data } = modelingData

    if (
      typeof data !== 'object' ||
      data === null ||
      !('surface_area' in data) ||
      typeof data.surface_area !== 'number'
    ) {
      return new Error('Measurement failed')
    }

    return {
      type: 'surfaceArea',
      surfaceArea: data.surface_area,
      entityIdsKey: selectedEntityIdsKey,
      unit: areaUnit,
    }
  }

  const [volumeResponse, centerOfMassResponse] = await Promise.all([
    sendModelingCommand({
      type: 'volume',
      entity_ids: [targetForRequest.entity.id],
      output_unit: volumeUnit,
    }),
    sendModelingCommand({
      type: 'center_of_mass',
      entity_ids: [targetForRequest.entity.id],
      output_unit: unit,
    }),
  ])
  const volumeModelingData = getModelingData(volumeResponse, 'volume')
  const centerOfMassModelingData = getModelingData(
    centerOfMassResponse,
    'center_of_mass'
  )
  if (volumeModelingData.type === 'error') {
    return volumeModelingData.error
  }
  if (centerOfMassModelingData.type === 'error') {
    return centerOfMassModelingData.error
  }
  const { data: volumeData } = volumeModelingData
  const { data: centerOfMassData } = centerOfMassModelingData

  if (
    typeof volumeData !== 'object' ||
    volumeData === null ||
    !('volume' in volumeData) ||
    typeof volumeData.volume !== 'number' ||
    typeof centerOfMassData !== 'object' ||
    centerOfMassData === null ||
    !('center_of_mass' in centerOfMassData)
  ) {
    return new Error('Measurement failed')
  }

  return {
    type: 'bodyDetails',
    volume: volumeData.volume,
    volumeUnit,
    centerOfMass: centerOfMassData.center_of_mass as Point3d,
    centerOfMassUnit: unit,
    entityIdsKey: selectedEntityIdsKey,
  }
}

function getMeasurementResultSummary(
  result: MeasurementResult,
  unit: UnitLength
): string {
  if (result.type === 'distance') {
    const hasDistanceRange = Math.abs(result.max - result.min) > 1e-9
    const value = hasDistanceRange
      ? `${formatDistance(result.min)}-${formatDistance(result.max)}`
      : formatDistance(result.min)
    return `${value} ${unit}`
  }

  if (result.type === 'edgeLength') {
    return `${formatDistance(result.length)} ${result.unit}`
  }

  if (result.type === 'surfaceArea') {
    return `${formatDistance(result.surfaceArea)} ${result.unit}`
  }

  return `${formatDistance(result.volume)} ${result.volumeUnit}`
}

export function MeasurementTool() {
  const { state } = useModelingContext()
  const { engineCommandManager, kclManager, store } = state.context
  const [distanceMode, setDistanceMode] =
    useState<DistanceMode>(defaultDistanceMode)
  const [status, setStatus] = useState<MeasurementStatus>('idle')
  const [result, setResult] = useState<MeasurementResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const latestRequestKey = useRef<string | null>(null)

  const selectedEntities = useMemo(
    () => getMeasurementEntities(state.context.selectionRanges),
    [state.context.selectionRanges]
  )
  const selectedEntityIds = selectedEntities.map((entity) => entity.id)
  const selectedEntityIdsKey = selectedEntities
    .map((entity) => `${entity.kind}:${entity.id}`)
    .join(':')
  const measurementTarget = useMemo(
    () => getMeasurementTarget(selectedEntities),
    [selectedEntities]
  )
  const measurementTargetKey =
    measurementTarget?.type === 'distance'
      ? distanceMode
      : (measurementTarget?.type ?? 'none')
  const measurementInputKey = `${selectedEntityIdsKey}:${measurementTargetKey}`
  const canMeasure = measurementTarget !== null
  const unit =
    kclManager.fileSettings.defaultLengthUnit ??
    store.defaultUnit?.current ??
    DEFAULT_DEFAULT_LENGTH_UNIT
  const areaUnit = getAreaUnit(unit)
  const volumeUnit = getVolumeUnit(unit)

  useEffect(() => {
    latestRequestKey.current = measurementInputKey
    setStatus('idle')
    setResult(null)
    setErrorMessage(null)
  }, [measurementInputKey])

  const sendModelingCommand = useCallback(
    (cmd: ModelingCmd) =>
      engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd,
      }),
    [engineCommandManager]
  )

  const measureSelection = useCallback(() => {
    const target = measurementTarget
    if (!target) {
      return
    }
    const targetForRequest: MeasurementTarget = target

    const requestKey = `${measurementInputKey}:${uuidv4()}`
    latestRequestKey.current = requestKey
    setStatus('measuring')
    setErrorMessage(null)

    requestMeasurement({
      targetForRequest,
      distanceMode,
      selectedEntityIdsKey,
      sendModelingCommand,
      unit,
      areaUnit,
      volumeUnit,
    })
      .then((measurementResult) => {
        if (latestRequestKey.current === requestKey) {
          if (measurementResult instanceof Error) {
            setErrorMessage(getResponseErrorMessage(measurementResult))
            return
          }
          setResult(measurementResult)
        }
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
    areaUnit,
    distanceMode,
    measurementInputKey,
    measurementTarget,
    selectedEntityIdsKey,
    sendModelingCommand,
    unit,
    volumeUnit,
  ])

  if (!state.matches('idle')) {
    return null
  }

  const matchingResult =
    result && resultMatchesSelection(result, selectedEntityIdsKey, distanceMode)
      ? result
      : null
  const hasDistanceRange =
    matchingResult?.type === 'distance' &&
    Math.abs(matchingResult.max - matchingResult.min) > 1e-9
  const distanceModeDisabled = selectedEntityIds.length !== 2

  return (
    <div className="flex min-w-64 flex-col gap-2 p-2 text-chalkboard-100 dark:text-chalkboard-10">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <CustomIcon
            name="dimension"
            className="h-4 w-4 shrink-0 text-chalkboard-70 dark:text-chalkboard-40"
          />
          <span className="truncate text-xs font-medium">Measure</span>
        </div>
        <span
          title="Selected entities"
          className="rounded bg-chalkboard-20 px-1.5 py-0.5 text-[10px] leading-3 tabular-nums text-chalkboard-70 dark:bg-chalkboard-90 dark:text-chalkboard-30"
        >
          {selectedEntityIds.length}
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
              disabled={distanceModeDisabled}
              title={
                mode.value === 'euclidean'
                  ? 'Euclidean distance'
                  : `${mode.label} axis distance`
              }
              onClick={() => setDistanceMode(mode.value)}
              className={`m-0 h-7 border-0 border-r border-solid border-chalkboard-20 px-2 text-xs last:border-r-0 disabled:cursor-not-allowed disabled:opacity-50 dark:border-chalkboard-80 ${
                isActive
                  ? 'bg-primary text-chalkboard-10'
                  : 'bg-transparent text-chalkboard-90 hover:bg-chalkboard-20 disabled:hover:bg-transparent dark:text-chalkboard-20 dark:hover:bg-chalkboard-80'
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
        title={getMeasureButtonTitle(
          measurementTarget,
          selectedEntityIds.length
        )}
        onClick={measureSelection}
        className="m-0 flex h-8 items-center justify-center gap-1.5 rounded border border-primary bg-primary px-2 text-xs font-medium text-chalkboard-10 disabled:cursor-not-allowed disabled:border-chalkboard-30 disabled:bg-chalkboard-20 disabled:text-chalkboard-60 dark:disabled:border-chalkboard-80 dark:disabled:bg-chalkboard-90 dark:disabled:text-chalkboard-50"
      >
        <CustomIcon name="dimension" className="h-4 w-4" />
        {status === 'measuring' ? 'Measuring' : 'Measure'}
      </button>

      {matchingResult?.type === 'distance' && (
        <div className="grid grid-cols-2 gap-3 border-t border-chalkboard-20 pt-2 dark:border-chalkboard-80">
          <MeasurementValue
            label={hasDistanceRange ? 'Min' : 'Distance'}
            value={matchingResult.min}
            unit={unit}
          />
          {hasDistanceRange && (
            <MeasurementValue
              label="Max"
              value={matchingResult.max}
              unit={unit}
            />
          )}
        </div>
      )}

      {matchingResult?.type === 'edgeLength' && (
        <div className="grid grid-cols-1 gap-3 border-t border-chalkboard-20 pt-2 dark:border-chalkboard-80">
          <MeasurementValue
            label="Length"
            value={matchingResult.length}
            unit={matchingResult.unit}
          />
        </div>
      )}

      {matchingResult?.type === 'surfaceArea' && (
        <div className="grid grid-cols-1 gap-3 border-t border-chalkboard-20 pt-2 dark:border-chalkboard-80">
          <MeasurementValue
            label="Surface area"
            value={matchingResult.surfaceArea}
            unit={matchingResult.unit}
          />
        </div>
      )}

      {matchingResult?.type === 'bodyDetails' && (
        <div className="grid grid-cols-1 gap-3 border-t border-chalkboard-20 pt-2 dark:border-chalkboard-80">
          <MeasurementValue
            label="Volume"
            value={matchingResult.volume}
            unit={matchingResult.volumeUnit}
          />
          <MeasurementPointValue
            label="CoM"
            point={matchingResult.centerOfMass}
            unit={matchingResult.centerOfMassUnit}
          />
        </div>
      )}

      {errorMessage && (
        <div className="truncate border-t border-chalkboard-20 pt-2 text-xs text-destroy-80 dark:border-chalkboard-80">
          {errorMessage}
        </div>
      )}
    </div>
  )
}

export function MeasurementStatusBarItem() {
  const { state } = useModelingContext()
  const { engineCommandManager, kclManager, store } = state.context
  const [isOpen, setIsOpen] = useState(false)
  const [result, setResult] = useState<MeasurementResult | null>(null)
  const latestRequestKey = useRef<string | null>(null)

  const isIdle = state.matches('idle')
  const selectedEntities = useMemo(
    () => getMeasurementEntities(state.context.selectionRanges),
    [state.context.selectionRanges]
  )
  const selectedEntityIdsKey = selectedEntities
    .map((entity) => `${entity.kind}:${entity.id}`)
    .join(':')
  const measurementTarget = useMemo(
    () => getMeasurementTarget(selectedEntities),
    [selectedEntities]
  )
  const measurementInputKey = `${selectedEntityIdsKey}:${
    measurementTarget?.type ?? 'none'
  }`
  const unit =
    kclManager.fileSettings.defaultLengthUnit ??
    store.defaultUnit?.current ??
    DEFAULT_DEFAULT_LENGTH_UNIT
  const areaUnit = getAreaUnit(unit)
  const volumeUnit = getVolumeUnit(unit)

  const sendModelingCommand = useCallback(
    (cmd: ModelingCmd) =>
      engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd,
      }),
    [engineCommandManager]
  )

  useEffect(() => {
    latestRequestKey.current = measurementInputKey
    setResult(null)

    if (!isIdle || !measurementTarget) {
      return
    }

    const targetForRequest: MeasurementTarget = measurementTarget
    const requestKey = `${measurementInputKey}:${uuidv4()}`
    latestRequestKey.current = requestKey

    requestMeasurement({
      targetForRequest,
      distanceMode: defaultDistanceMode,
      selectedEntityIdsKey,
      sendModelingCommand,
      unit,
      areaUnit,
      volumeUnit,
    })
      .then((measurementResult) => {
        if (
          latestRequestKey.current !== requestKey ||
          measurementResult instanceof Error
        ) {
          return
        }

        setResult(measurementResult)
      })
      .catch(() => {
        // Best-effort measurements should fail silently in the status bar.
      })
  }, [
    areaUnit,
    isIdle,
    measurementInputKey,
    measurementTarget,
    selectedEntityIdsKey,
    sendModelingCommand,
    unit,
    volumeUnit,
  ])

  const matchingResult =
    result &&
    resultMatchesSelection(result, selectedEntityIdsKey, defaultDistanceMode)
      ? result
      : null
  const summary = matchingResult
    ? getMeasurementResultSummary(matchingResult, unit)
    : null

  return (
    <div className="relative">
      <button
        type="button"
        className={`${defaultStatusBarItemClassNames} max-w-[32vw] gap-1`}
        data-testid="measurement-status"
        aria-expanded={isOpen}
        aria-label={summary ? `Measure: ${summary}` : 'Measure'}
        onClick={() => setIsOpen(true)}
      >
        <CustomIcon name="dimension" className="h-3.5 w-3.5 shrink-0" />
        {summary && (
          <span className="max-w-32 truncate tabular-nums">{summary}</span>
        )}
        {!isOpen && (
          <Tooltip wrapperClassName="ui-open:hidden" position="top-right">
            {summary ? `Measure: ${summary}` : 'Measure'}
          </Tooltip>
        )}
      </button>
      {isOpen && (
        <div
          className="absolute right-0 bottom-full mb-1 z-20 w-[min(320px,calc(100vw-1rem))] max-h-[60vh] overflow-auto rounded-md border border-chalkboard-30 bg-chalkboard-10 shadow-lg dark:border-chalkboard-80 dark:bg-chalkboard-100"
          data-testid="measurement-popover"
        >
          <div className="sticky top-0 z-10 flex justify-end border-b border-chalkboard-30 bg-chalkboard-10 p-1 dark:border-chalkboard-80 dark:bg-chalkboard-100">
            <button
              type="button"
              className="flex items-center gap-1 rounded-sm px-2 py-1 text-xs text-chalkboard-80 hover:bg-chalkboard-20 focus:bg-chalkboard-20 focus:outline-none dark:text-chalkboard-20 dark:hover:bg-chalkboard-90 dark:focus:bg-chalkboard-90"
              onClick={() => setIsOpen(false)}
            >
              <CustomIcon name="close" className="h-3.5 w-3.5" />
              Close
            </button>
          </div>
          <MeasurementTool />
        </div>
      )}
    </div>
  )
}
