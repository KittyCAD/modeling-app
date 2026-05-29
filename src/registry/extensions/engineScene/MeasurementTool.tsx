import type {
  EntityType,
  ModelingCmd,
  Point3d,
  UnitArea,
  UnitLength,
  UnitVolume,
} from '@kittycad/lib'
import { CustomIcon } from '@src/components/CustomIcon'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { DEFAULT_DEFAULT_LENGTH_UNIT } from '@src/lib/constants'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import { reportRejection } from '@src/lib/trap'
import { uuidv4 } from '@src/lib/utils'
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
  pointDistance,
} from './measurementUtils'

type MeasurementStatus = 'idle' | 'measuring'
type SelectionFilterMode = 'default' | 'faces' | 'edges' | 'bodies'

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

const selectionFilterOptions: Array<{
  value: SelectionFilterMode
  label: string
  title: string
  filter?: EntityType[]
}> = [
  {
    value: 'default',
    label: 'All',
    title: 'Default selection filter',
  },
  {
    value: 'faces',
    label: 'Faces',
    title: 'Select faces',
    filter: ['face', 'object'],
  },
  {
    value: 'edges',
    label: 'Edges',
    title: 'Select edges',
    filter: ['edge', 'curve', 'segment'],
  },
  {
    value: 'bodies',
    label: 'Bodies',
    title: 'Select solid bodies',
    filter: ['solid3d'],
  },
]

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
    return 'Measure straight-line edge length'
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

function getModelingData(response: unknown, expectedType: string): unknown {
  if (!isModelingResponse(response)) {
    throw new Error(getResponseErrorMessage(response))
  }

  const modelingResponse = response.resp.data.modeling_response
  if (modelingResponse.type !== expectedType || !('data' in modelingResponse)) {
    throw new Error('Measurement failed')
  }

  return modelingResponse.data
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

export function MeasurementTool() {
  const { state } = useModelingContext()
  const { engineCommandManager, kclManager, store, wasmInstance } =
    state.context
  const [distanceMode, setDistanceMode] = useState<DistanceMode>('euclidean')
  const [selectionFilterMode, setSelectionFilterMode] =
    useState<SelectionFilterMode>('default')
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

  const handleSelectionFilterChange = useCallback(
    (mode: SelectionFilterMode) => {
      const option = selectionFilterOptions.find(({ value }) => value === mode)
      if (!option) {
        return
      }

      setSelectionFilterMode(mode)
      if (option.filter) {
        kclManager.setSelectionFilter(option.filter, wasmInstance)
      } else {
        kclManager.setSelectionFilterToDefault(wasmInstance)
      }
    },
    [kclManager, wasmInstance]
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

    async function runMeasurement(): Promise<MeasurementResult> {
      if (targetForRequest.type === 'distance') {
        const [entityId1, entityId2] = targetForRequest.entityIds
        const data = getModelingData(
          await sendModelingCommand({
            type: 'entity_get_distance',
            entity_id1: entityId1,
            entity_id2: entityId2,
            distance_type: getDistanceTypeForMode(distanceMode),
          }),
          'entity_get_distance'
        )

        if (
          typeof data !== 'object' ||
          data === null ||
          !('min_distance' in data) ||
          !('max_distance' in data) ||
          typeof data.min_distance !== 'number' ||
          typeof data.max_distance !== 'number'
        ) {
          throw new Error('Measurement failed')
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
        const data = getModelingData(
          await sendModelingCommand({
            type: 'curve_get_end_points',
            curve_id: targetForRequest.entity.id,
          }),
          'curve_get_end_points'
        )

        if (
          typeof data !== 'object' ||
          data === null ||
          !('start' in data) ||
          !('end' in data)
        ) {
          throw new Error('Measurement failed')
        }

        return {
          type: 'edgeLength',
          length: pointDistance(data.start as Point3d, data.end as Point3d),
          entityIdsKey: selectedEntityIdsKey,
          unit,
        }
      }

      if (targetForRequest.type === 'surfaceArea') {
        const data = getModelingData(
          await sendModelingCommand({
            type: 'surface_area',
            entity_ids: [targetForRequest.entity.id],
            output_unit: areaUnit,
          }),
          'surface_area'
        )

        if (
          typeof data !== 'object' ||
          data === null ||
          !('surface_area' in data) ||
          typeof data.surface_area !== 'number'
        ) {
          throw new Error('Measurement failed')
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
      const volumeData = getModelingData(volumeResponse, 'volume')
      const centerOfMassData = getModelingData(
        centerOfMassResponse,
        'center_of_mass'
      )

      if (
        typeof volumeData !== 'object' ||
        volumeData === null ||
        !('volume' in volumeData) ||
        typeof volumeData.volume !== 'number' ||
        typeof centerOfMassData !== 'object' ||
        centerOfMassData === null ||
        !('center_of_mass' in centerOfMassData)
      ) {
        throw new Error('Measurement failed')
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

    runMeasurement()
      .then((measurementResult) => {
        if (latestRequestKey.current === requestKey) {
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
    <div className="absolute bottom-2 left-2 z-10 flex max-w-[calc(100%-1rem)] flex-col items-start gap-2 pointer-events-auto">
      <div className="flex min-w-56 max-w-80 flex-col gap-1.5 rounded border border-chalkboard-20 bg-chalkboard-10/85 p-2 text-chalkboard-100 shadow-lg backdrop-blur-sm dark:border-chalkboard-80 dark:bg-chalkboard-100/85 dark:text-chalkboard-10">
        <div className="grid grid-cols-4 rounded border border-chalkboard-20 bg-chalkboard-10 p-0 dark:border-chalkboard-80 dark:bg-chalkboard-90">
          {selectionFilterOptions.map((option) => {
            const isActive = selectionFilterMode === option.value
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={isActive}
                title={option.title}
                onClick={() => handleSelectionFilterChange(option.value)}
                className={`m-0 h-7 border-0 border-r border-solid border-chalkboard-20 px-2 text-xs last:border-r-0 dark:border-chalkboard-80 ${
                  isActive
                    ? 'bg-primary text-chalkboard-10'
                    : 'bg-transparent text-chalkboard-90 hover:bg-chalkboard-20 dark:text-chalkboard-20 dark:hover:bg-chalkboard-80'
                }`}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex min-w-56 max-w-80 flex-col gap-2 rounded border border-chalkboard-20 bg-chalkboard-10/85 p-2 text-chalkboard-100 shadow-lg backdrop-blur-sm dark:border-chalkboard-80 dark:bg-chalkboard-100/85 dark:text-chalkboard-10">
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
              label="Straight length"
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
    </div>
  )
}
