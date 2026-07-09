import type {
  ModelingCmd,
  Point3d,
  UnitArea,
  UnitLength,
  UnitVolume,
} from '@kittycad/lib'
import { CopyTextButton, Draggable } from '@kittycad/ui-components'
import { useSignals } from '@preact/signals-react/runtime'
import { CustomIcon } from '@src/components/CustomIcon'
import { defaultStatusBarItemClassNames } from '@src/components/StatusBar/StatusBar'
import Tooltip from '@src/components/Tooltip'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { DEFAULT_DEFAULT_LENGTH_UNIT } from '@src/lib/constants'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import { reportRejection } from '@src/lib/trap'
import { isArray, uuidv4 } from '@src/lib/utils'
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import {
  type MeasurementTarget,
  getDefaultDistanceModeForTarget,
  getDistanceMeasurementLabel,
  getDistanceModeLabel,
  getMeasurementTarget,
  isUnsupportedDistanceMode,
  unsupportedFaceSurfaceAreaMessage,
  unsupportedTopologyDistanceMessage,
} from './measurementCapabilities'
import { measurementToolService } from './measurementToolService'
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
      type: 'bodyDetails'
      volume: number
      volumeUnit: UnitVolume
      surfaceArea: number
      surfaceAreaUnit: UnitArea
      centerOfMass: Point3d
      centerOfMassUnit: UnitLength
      entityIdsKey: string
    }

type ModelingDataResult =
  | { type: 'data'; data: unknown }
  | { type: 'error'; error: Error }

type SendModelingCommand = (cmd: ModelingCmd) => Promise<unknown>

function getMeasurementEntityLabel(entity: MeasurementEntity): string {
  if (entity.kind === 'body') {
    return 'Body'
  }

  if (entity.kind === 'face') {
    return 'Face'
  }

  if (entity.kind === 'edge') {
    return 'Edge'
  }

  return 'Entity'
}

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

function MeasurementSelectionSummary({
  selectedEntities,
}: {
  selectedEntities: MeasurementEntity[]
}) {
  if (selectedEntities.length === 0) {
    return (
      <div className="rounded border border-chalkboard-20 p-2 text-xs text-chalkboard-70 dark:border-chalkboard-80 dark:text-chalkboard-40">
        No selection.
      </div>
    )
  }

  return (
    <div className="flex max-h-28 flex-col gap-1 overflow-auto rounded border border-chalkboard-20 p-1 divide-y divide-chalkboard-30 dark:border-chalkboard-80 dark:divide-chalkboard-80">
      {selectedEntities.map((entity, index) => (
        <div
          key={`${entity.kind}:${entity.id}:${index}`}
          className="grid grid-cols-[auto,minmax(0,1fr)] items-center gap-2 px-1 py-1 text-xs"
        >
          <span className="text-chalkboard-80 dark:text-chalkboard-30">
            {getMeasurementEntityLabel(entity)}
          </span>
        </div>
      ))}
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
    if (isUnsupportedDistanceMode(targetForRequest, distanceMode)) {
      return new Error(unsupportedTopologyDistanceMessage)
    }

    const [entity1, entity2] = targetForRequest.entities
    const modelingData = getModelingData(
      await sendModelingCommand({
        type: 'entity_get_distance',
        entity_id1: entity1.id,
        entity_id2: entity2.id,
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

  if (targetForRequest.type === 'faceSurfaceArea') {
    return new Error(unsupportedFaceSurfaceAreaMessage)
  }

  const [volumeResponse, surfaceAreaResponse, centerOfMassResponse] =
    await Promise.all([
      sendModelingCommand({
        type: 'volume',
        entity_ids: [targetForRequest.entity.id],
        output_unit: volumeUnit,
      }),
      sendModelingCommand({
        type: 'surface_area',
        entity_ids: [targetForRequest.entity.id],
        output_unit: areaUnit,
      }),
      sendModelingCommand({
        type: 'center_of_mass',
        entity_ids: [targetForRequest.entity.id],
        output_unit: unit,
      }),
    ])
  const volumeModelingData = getModelingData(volumeResponse, 'volume')
  const surfaceAreaModelingData = getModelingData(
    surfaceAreaResponse,
    'surface_area'
  )
  const centerOfMassModelingData = getModelingData(
    centerOfMassResponse,
    'center_of_mass'
  )
  if (volumeModelingData.type === 'error') {
    return volumeModelingData.error
  }
  if (surfaceAreaModelingData.type === 'error') {
    return surfaceAreaModelingData.error
  }
  if (centerOfMassModelingData.type === 'error') {
    return centerOfMassModelingData.error
  }
  const { data: volumeData } = volumeModelingData
  const { data: surfaceAreaData } = surfaceAreaModelingData
  const { data: centerOfMassData } = centerOfMassModelingData

  if (
    typeof volumeData !== 'object' ||
    volumeData === null ||
    !('volume' in volumeData) ||
    typeof volumeData.volume !== 'number' ||
    typeof surfaceAreaData !== 'object' ||
    surfaceAreaData === null ||
    !('surface_area' in surfaceAreaData) ||
    typeof surfaceAreaData.surface_area !== 'number' ||
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
    surfaceArea: surfaceAreaData.surface_area,
    surfaceAreaUnit: areaUnit,
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
    return `${getDistanceMeasurementLabel(result.mode)}: ${value} ${unit}`
  }

  if (result.type === 'edgeLength') {
    return `${formatDistance(result.length)} ${result.unit}`
  }

  return `${formatDistance(result.volume)} ${result.volumeUnit}`
}

function getMeasurementResultText(
  result: MeasurementResult,
  unit: UnitLength
): string {
  if (result.type === 'distance') {
    const label = getDistanceMeasurementLabel(result.mode)
    const hasDistanceRange = Math.abs(result.max - result.min) > 1e-9
    if (!hasDistanceRange) {
      return `${label}: ${formatDistance(result.min)} ${unit}`
    }

    return [
      `${label} min: ${formatDistance(result.min)} ${unit}`,
      `${label} max: ${formatDistance(result.max)} ${unit}`,
    ].join('\n')
  }

  if (result.type === 'edgeLength') {
    return `Length: ${formatDistance(result.length)} ${result.unit}`
  }

  return [
    `Volume: ${formatDistance(result.volume)} ${result.volumeUnit}`,
    `Surface area: ${formatDistance(result.surfaceArea)} ${
      result.surfaceAreaUnit
    }`,
    `CoM: ${formatPoint3d(result.centerOfMass)} ${result.centerOfMassUnit}`,
  ].join('\n')
}

function showMeasurementCopySuccess() {
  toast.success('Copied measurement to clipboard.')
}

function showMeasurementCopyError() {
  toast.error('Failed to copy measurement.')
}

const copyMeasurementButtonClassName =
  'm-0 w-full border-0 bg-transparent text-left hover:bg-chalkboard-20 focus:bg-chalkboard-20 focus:outline-none dark:hover:bg-chalkboard-90 dark:focus:bg-chalkboard-90'

export function MeasurementTool() {
  useSignals()
  const { state } = useModelingContext()
  const { engineCommandManager, kclManager, store } = state.context
  const [distanceModePreference, setDistanceModePreference] = useState<{
    selectionKey: string
    mode: DistanceMode
  } | null>(null)
  const [status, setStatus] = useState<MeasurementStatus>('idle')
  const [result, setResult] = useState<MeasurementResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const latestRequestKey = useRef<string | null>(null)

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
  const serviceDistanceMode = measurementToolService.lastDistanceMode.value
  const distanceMode =
    distanceModePreference?.selectionKey === selectedEntityIdsKey
      ? distanceModePreference.mode
      : getDefaultDistanceModeForTarget(measurementTarget, serviceDistanceMode)
  const measurementTargetKey =
    measurementTarget?.type === 'distance'
      ? distanceMode
      : (measurementTarget?.type ?? 'none')
  const measurementInputKey = `${selectedEntityIdsKey}:${measurementTargetKey}`
  const unit =
    kclManager.fileSettings.defaultLengthUnit ??
    store.defaultUnit?.current ??
    DEFAULT_DEFAULT_LENGTH_UNIT
  const areaUnit = getAreaUnit(unit)
  const volumeUnit = getVolumeUnit(unit)
  const isIdle = state.matches('idle')

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
    const target = measurementTarget
    latestRequestKey.current = measurementInputKey
    setStatus('idle')
    setResult(null)
    setErrorMessage(null)

    if (!isIdle) {
      return
    }

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
    isIdle,
    measurementInputKey,
    measurementTarget,
    selectedEntityIdsKey,
    sendModelingCommand,
    unit,
    volumeUnit,
  ])

  if (!isIdle) {
    return null
  }

  const matchingResult =
    result && resultMatchesSelection(result, selectedEntityIdsKey, distanceMode)
      ? result
      : null
  const hasDistanceRange =
    matchingResult?.type === 'distance' &&
    Math.abs(matchingResult.max - matchingResult.min) > 1e-9
  const showDistanceModes = measurementTarget?.type === 'distance'

  return (
    <div className="flex min-w-64 flex-col gap-2 p-2 text-chalkboard-100 dark:text-chalkboard-10">
      <MeasurementSelectionSummary selectedEntities={selectedEntities} />

      {showDistanceModes && (
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
                onClick={() => {
                  measurementToolService.setDistanceMode(mode.value)
                  setDistanceModePreference({
                    selectionKey: selectedEntityIdsKey,
                    mode: mode.value,
                  })
                }}
                className={`m-0 h-7 border-0 border-r border-solid border-chalkboard-20 px-2 text-xs last:border-r-0 dark:border-chalkboard-80 ${
                  isActive
                    ? '!bg-primary !text-chalkboard-10 hover:!bg-primary focus:!bg-primary'
                    : 'bg-transparent text-chalkboard-90 hover:bg-chalkboard-20 dark:text-chalkboard-20 dark:hover:bg-chalkboard-80'
                }`}
              >
                {mode.label}
              </button>
            )
          })}
        </fieldset>
      )}

      {status === 'measuring' && (
        <div className="border-t border-chalkboard-20 pt-2 text-xs text-chalkboard-70 dark:border-chalkboard-80 dark:text-chalkboard-40">
          Measuring...
        </div>
      )}

      {!measurementTarget && selectedEntities.length > 0 && (
        <div className="border-t border-chalkboard-20 pt-2 text-xs text-chalkboard-70 dark:border-chalkboard-80 dark:text-chalkboard-40">
          Select one measurable entity or two entities.
        </div>
      )}

      {matchingResult?.type === 'distance' && (
        <CopyTextButton
          textToCopy={getMeasurementResultText(matchingResult, unit)}
          title="Copy measurement"
          onCopySuccess={showMeasurementCopySuccess}
          onCopyError={showMeasurementCopyError}
          className={`${copyMeasurementButtonClassName} grid grid-cols-2 gap-3 border-t border-chalkboard-20 pt-2 dark:border-chalkboard-80`}
        >
          <MeasurementValue
            label={
              hasDistanceRange
                ? `${getDistanceModeLabel(matchingResult.mode)} min`
                : getDistanceMeasurementLabel(matchingResult.mode)
            }
            value={matchingResult.min}
            unit={unit}
          />
          {hasDistanceRange && (
            <MeasurementValue
              label={`${getDistanceModeLabel(matchingResult.mode)} max`}
              value={matchingResult.max}
              unit={unit}
            />
          )}
        </CopyTextButton>
      )}

      {matchingResult?.type === 'edgeLength' && (
        <CopyTextButton
          textToCopy={getMeasurementResultText(matchingResult, unit)}
          title="Copy measurement"
          onCopySuccess={showMeasurementCopySuccess}
          onCopyError={showMeasurementCopyError}
          className={`${copyMeasurementButtonClassName} grid grid-cols-1 gap-3 border-t border-chalkboard-20 pt-2 dark:border-chalkboard-80`}
        >
          <MeasurementValue
            label="Length"
            value={matchingResult.length}
            unit={matchingResult.unit}
          />
        </CopyTextButton>
      )}

      {matchingResult?.type === 'bodyDetails' && (
        <CopyTextButton
          textToCopy={getMeasurementResultText(matchingResult, unit)}
          title="Copy measurement"
          onCopySuccess={showMeasurementCopySuccess}
          onCopyError={showMeasurementCopyError}
          className={`${copyMeasurementButtonClassName} grid grid-cols-1 gap-3 border-t border-chalkboard-20 pt-2 dark:border-chalkboard-80`}
        >
          <MeasurementValue
            label="Volume"
            value={matchingResult.volume}
            unit={matchingResult.volumeUnit}
          />
          <MeasurementValue
            label="Surface area"
            value={matchingResult.surfaceArea}
            unit={matchingResult.surfaceAreaUnit}
          />
          <MeasurementPointValue
            label="CoM"
            point={matchingResult.centerOfMass}
            unit={matchingResult.centerOfMassUnit}
          />
        </CopyTextButton>
      )}

      {errorMessage && (
        <CopyTextButton
          textToCopy={errorMessage}
          title="Copy measurement error"
          onCopySuccess={showMeasurementCopySuccess}
          onCopyError={showMeasurementCopyError}
          className={`${copyMeasurementButtonClassName} whitespace-pre-wrap break-words border-t border-chalkboard-20 pt-2 text-xs text-destroy-80 dark:border-chalkboard-80`}
        >
          <span>{errorMessage}</span>
        </CopyTextButton>
      )}
    </div>
  )
}

export function MeasurementStatusBarItem() {
  useSignals()
  const { state } = useModelingContext()
  const { engineCommandManager, kclManager, store } = state.context
  const [streamElement, setStreamElement] = useState<HTMLElement | null>(null)
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
  const serviceDistanceMode = measurementToolService.lastDistanceMode.value
  const defaultStatusDistanceMode = getDefaultDistanceModeForTarget(
    measurementTarget,
    serviceDistanceMode
  )
  const measurementInputKey = `${selectedEntityIdsKey}:${
    measurementTarget?.type === 'distance'
      ? defaultStatusDistanceMode
      : (measurementTarget?.type ?? 'none')
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
      distanceMode: defaultStatusDistanceMode,
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
    defaultStatusDistanceMode,
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
    resultMatchesSelection(
      result,
      selectedEntityIdsKey,
      defaultStatusDistanceMode
    )
      ? result
      : null
  const summary = matchingResult
    ? getMeasurementResultSummary(matchingResult, unit)
    : null
  const isOpen = measurementToolService.isOpen.value
  const streamContainerRef = useMemo<RefObject<HTMLElement | null>>(
    () => ({ current: streamElement }),
    [streamElement]
  )

  useEffect(() => {
    if (!isOpen) {
      setStreamElement(null)
      return
    }

    setStreamElement(document.getElementById('stream'))
  }, [isOpen])

  return (
    <div className="relative">
      <button
        type="button"
        className={`${defaultStatusBarItemClassNames} max-w-[32vw] gap-1`}
        data-testid="measurement-status"
        aria-expanded={isOpen}
        aria-label={summary ? `Measure: ${summary}` : 'Measure'}
        onClick={() => {
          measurementToolService.open()
        }}
      >
        <CustomIcon name="ruler" className="h-5 w-5 shrink-0" />
        {summary && (
          <span className="max-w-32 truncate tabular-nums">{summary}</span>
        )}
        {!isOpen && (
          <Tooltip wrapperClassName="ui-open:hidden" position="top-right">
            {summary ? `Measure: ${summary}` : 'Measure'}
          </Tooltip>
        )}
      </button>
      {isOpen &&
        streamElement &&
        createPortal(
          <MeasurementDraggablePanel containerRef={streamContainerRef} />,
          streamElement
        )}
    </div>
  )
}

export function MeasurementDraggablePanel({
  containerRef,
}: {
  containerRef: RefObject<HTMLElement | null>
}) {
  useSignals()

  if (!measurementToolService.isOpen.value) {
    return null
  }

  return (
    <Draggable
      containerRef={containerRef}
      side="top"
      className="pointer-events-auto max-w-[calc(100%-1rem)] overflow-hidden rounded-md border border-chalkboard-30 bg-chalkboard-10 text-chalkboard-100 shadow-lg dark:border-chalkboard-80 dark:bg-chalkboard-100 dark:text-chalkboard-10"
      data-testid="measurement-draggable-panel"
      style={{
        position: 'absolute',
        bottom: 8,
        left: 8,
        width: 320,
        zIndex: 20,
      }}
      onContextMenu={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      Handle={
        <div className="flex min-h-8 items-center justify-between gap-2 border-b border-chalkboard-30 bg-chalkboard-10 px-2 py-1 dark:border-chalkboard-80 dark:bg-chalkboard-100">
          <div className="flex min-w-0 items-center gap-1.5">
            <CustomIcon
              name="ruler"
              className="h-5 w-5 shrink-0 text-chalkboard-70 dark:text-chalkboard-40"
            />
            <span className="truncate text-xs font-medium">Measure</span>
          </div>
          <button
            type="button"
            className="flex items-center gap-1 rounded-sm px-2 py-1 text-xs text-chalkboard-80 hover:bg-chalkboard-20 focus:bg-chalkboard-20 focus:outline-none dark:text-chalkboard-20 dark:hover:bg-chalkboard-90 dark:focus:bg-chalkboard-90"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => {
              measurementToolService.close()
            }}
          >
            <CustomIcon name="close" className="h-3.5 w-3.5" />
            Close
          </button>
        </div>
      }
    >
      <MeasurementTool />
    </Draggable>
  )
}
