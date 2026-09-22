import type {
  ModelingCmd,
  Point3d,
  UnitArea,
  UnitDensity,
  UnitLength,
  UnitMass,
  UnitVolume,
} from '@kittycad/lib'
import { CopyTextButton, Draggable } from '@kittycad/ui-components'
import { useSignals } from '@preact/signals-react/runtime'
import { CustomIcon } from '@src/components/CustomIcon'
import { defaultStatusBarItemClassNames } from '@src/components/StatusBar/StatusBar'
import Tooltip from '@src/components/Tooltip'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { DEFAULT_DEFAULT_LENGTH_UNIT } from '@src/lib/constants'
import {
  getModelingData,
  getResponseErrorMessage,
} from '@src/lib/engineConnection/utils'
import { reportRejection } from '@src/lib/trap'
import { uuidv4 } from '@src/lib/utils'
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
import { measurementToolService } from '../measurementToolService'
import {
  formatDistance,
  formatPoint3d,
  getAreaUnit,
  getVolumeUnit,
  unitAreaLabels,
  unitVolumeLabels,
} from '../measurementUtils'
import { physicalAnalysisService } from './physicalAnalysisService'
import {
  convertMaterialDensity,
  getDefaultDensityUnit,
  getDefaultMassUnit,
  getDefaultMaterialDensity,
  isValidMaterialDensity,
  unitAreaOptions,
  unitDensityLabels,
  unitDensityOptions,
  unitLengthOptions,
  unitMassOptions,
  unitVolumeOptions,
} from './physicalAnalysisUtils'

const physicalAnalysisFailedMessage = 'Physical analysis failed'
const densityCommitDebounceMs = 400
// Sized so every result fits without truncating or scrolling: content is
// 289px tall at any width, and values stop being clipped at 380px wide.
const defaultPanelWidth = 400
const defaultPanelHeight = 300
const panelMargin = 8

type SendModelingCommand = (cmd: ModelingCmd) => Promise<unknown>

interface PhysicalAnalysisResult {
  volume: number
  volumeUnit: UnitVolume
  surfaceArea: number
  surfaceAreaUnit: UnitArea
  mass: number
  massUnit: UnitMass
  centerOfMass: Point3d
  centerOfMassUnit: UnitLength
}

function getNumberField(data: unknown, key: string): number | null {
  if (typeof data !== 'object' || data === null || !(key in data)) {
    return null
  }

  const value = (data as Record<string, unknown>)[key]
  return typeof value === 'number' ? value : null
}

function getPoint3dField(data: unknown, key: string): Point3d | null {
  if (typeof data !== 'object' || data === null || !(key in data)) {
    return null
  }

  const value = (data as Record<string, unknown>)[key]
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as Point3d).x !== 'number' ||
    typeof (value as Point3d).y !== 'number' ||
    typeof (value as Point3d).z !== 'number'
  ) {
    return null
  }

  return value as Point3d
}

/**
 * An empty `entity_ids` tells the engine to use the default scene, so this
 * always reports on the whole model rather than the current selection.
 */
async function requestPhysicalAnalysis({
  sendModelingCommand,
  lengthUnit,
  areaUnit,
  volumeUnit,
  massUnit,
  densityUnit,
  materialDensity,
}: {
  sendModelingCommand: SendModelingCommand
  lengthUnit: UnitLength
  areaUnit: UnitArea
  volumeUnit: UnitVolume
  massUnit: UnitMass
  densityUnit: UnitDensity
  materialDensity: number
}): Promise<PhysicalAnalysisResult | Error> {
  const [
    volumeResponse,
    surfaceAreaResponse,
    centerOfMassResponse,
    massResponse,
  ] = await Promise.all([
    sendModelingCommand({
      type: 'volume',
      entity_ids: [],
      output_unit: volumeUnit,
    }),
    sendModelingCommand({
      type: 'surface_area',
      entity_ids: [],
      output_unit: areaUnit,
    }),
    sendModelingCommand({
      type: 'center_of_mass',
      entity_ids: [],
      output_unit: lengthUnit,
    }),
    sendModelingCommand({
      type: 'mass',
      entity_ids: [],
      output_unit: massUnit,
      material_density: materialDensity,
      material_density_unit: densityUnit,
    }),
  ])

  const results = [
    getModelingData(volumeResponse, 'volume', physicalAnalysisFailedMessage),
    getModelingData(
      surfaceAreaResponse,
      'surface_area',
      physicalAnalysisFailedMessage
    ),
    getModelingData(
      centerOfMassResponse,
      'center_of_mass',
      physicalAnalysisFailedMessage
    ),
    getModelingData(massResponse, 'mass', physicalAnalysisFailedMessage),
  ]

  for (const result of results) {
    if (result.type === 'error') {
      return result.error
    }
  }

  const [volumeData, surfaceAreaData, centerOfMassData, massData] = results.map(
    (result) => (result.type === 'data' ? result.data : null)
  )

  const volume = getNumberField(volumeData, 'volume')
  const surfaceArea = getNumberField(surfaceAreaData, 'surface_area')
  const mass = getNumberField(massData, 'mass')
  const centerOfMass = getPoint3dField(centerOfMassData, 'center_of_mass')

  if (
    volume === null ||
    surfaceArea === null ||
    mass === null ||
    centerOfMass === null
  ) {
    return new Error(physicalAnalysisFailedMessage)
  }

  return {
    volume,
    volumeUnit,
    surfaceArea,
    surfaceAreaUnit: areaUnit,
    mass,
    massUnit,
    centerOfMass,
    centerOfMassUnit: lengthUnit,
  }
}

function getPhysicalAnalysisText(
  result: PhysicalAnalysisResult,
  materialDensity: number,
  densityUnit: UnitDensity
): string {
  return [
    `Volume: ${formatDistance(result.volume)} ${unitVolumeLabels[result.volumeUnit]}`,
    `Surface area: ${formatDistance(result.surfaceArea)} ${unitAreaLabels[result.surfaceAreaUnit]}`,
    `Mass: ${formatDistance(result.mass)} ${result.massUnit}`,
    `CoM: ${formatPoint3d(result.centerOfMass)} ${result.centerOfMassUnit}`,
    `Density: ${formatDistance(materialDensity)} ${unitDensityLabels[densityUnit]}`,
  ].join('\n')
}

function AnalysisValue({
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

function AnalysisPointValue({
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

function UnitSelect<T extends string>({
  label,
  testId,
  value,
  options,
  labels,
  onChange,
}: {
  label: string
  testId: string
  value: T
  options: readonly T[]
  labels?: Record<T, string>
  onChange: (value: T) => void
}) {
  return (
    <label className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[10px] leading-3 text-chalkboard-70 dark:text-chalkboard-40">
        {label}
      </span>
      <select
        data-testid={testId}
        className="w-full rounded-sm border border-chalkboard-30 bg-transparent p-1 text-xs dark:border-chalkboard-80"
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {labels ? labels[option] : option}
          </option>
        ))}
      </select>
    </label>
  )
}

function showCopySuccess() {
  toast.success('Copied physical analysis to clipboard.')
}

function showCopyError() {
  toast.error('Failed to copy physical analysis.')
}

const copyResultsButtonClassName =
  'm-0 w-full border-0 bg-transparent text-left hover:bg-chalkboard-20 focus:bg-chalkboard-20 focus:outline-none dark:hover:bg-chalkboard-90 dark:focus:bg-chalkboard-90'

export function PhysicalAnalysisTool() {
  useSignals()
  const { state } = useModelingContext()
  const { engineCommandManager, kclManager, store } = state.context
  const [status, setStatus] = useState<'idle' | 'analyzing'>('idle')
  const [result, setResult] = useState<PhysicalAnalysisResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const latestRequestKey = useRef<string | null>(null)

  const isIdle = state.matches('idle')
  const isExecuting = kclManager.isExecutingSignal.value
  const preferences = physicalAnalysisService.preferences.value

  const fileLengthUnit =
    kclManager.fileSettings.defaultLengthUnit ??
    store.defaultUnit?.current ??
    DEFAULT_DEFAULT_LENGTH_UNIT

  // A null preference means "follow the file", so untouched dropdowns re-seed
  // when the file's unit changes while explicit choices stay pinned.
  const lengthUnit = preferences.lengthUnit ?? fileLengthUnit
  const areaUnit = preferences.areaUnit ?? getAreaUnit(fileLengthUnit)
  const volumeUnit = preferences.volumeUnit ?? getVolumeUnit(fileLengthUnit)
  const massUnit = preferences.massUnit ?? getDefaultMassUnit(fileLengthUnit)
  const densityUnit =
    preferences.densityUnit ?? getDefaultDensityUnit(fileLengthUnit)
  const materialDensity =
    preferences.materialDensity ?? getDefaultMaterialDensity(densityUnit)

  const [densityInput, setDensityInput] = useState(String(materialDensity))
  const parsedDensityInput = Number.parseFloat(densityInput)
  const isDensityInputValid = isValidMaterialDensity(parsedDensityInput)

  useEffect(() => {
    setDensityInput(String(materialDensity))
  }, [materialDensity])

  // Debounce so typing a density does not fire an engine request per keystroke.
  useEffect(() => {
    if (!isDensityInputValid || parsedDensityInput === materialDensity) {
      return
    }

    const timeoutId = setTimeout(() => {
      physicalAnalysisService.setPreference(
        'materialDensity',
        parsedDensityInput
      )
    }, densityCommitDebounceMs)

    return () => clearTimeout(timeoutId)
  }, [isDensityInputValid, parsedDensityInput, materialDensity])

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
    if (!isIdle) {
      return
    }

    // Any change to a unit, the density, or the model makes the numbers on
    // screen stale, so drop them rather than showing values that no longer
    // match the controls above them.
    setResult(null)
    setErrorMessage(null)

    if (isExecuting) {
      // Wait for the new geometry before asking the engine to measure it.
      setStatus('analyzing')
      return
    }

    const requestKey = `${lengthUnit}:${areaUnit}:${volumeUnit}:${massUnit}:${densityUnit}:${materialDensity}:${uuidv4()}`
    latestRequestKey.current = requestKey
    setStatus('analyzing')

    requestPhysicalAnalysis({
      sendModelingCommand,
      lengthUnit,
      areaUnit,
      volumeUnit,
      massUnit,
      densityUnit,
      materialDensity,
    })
      .then((analysisResult) => {
        if (latestRequestKey.current !== requestKey) {
          return
        }

        if (analysisResult instanceof Error) {
          setResult(null)
          setErrorMessage(analysisResult.message)
          return
        }

        setResult(analysisResult)
      })
      .catch((error) => {
        if (latestRequestKey.current === requestKey) {
          setResult(null)
          setErrorMessage(
            getResponseErrorMessage(error, physicalAnalysisFailedMessage)
          )
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
    densityUnit,
    isExecuting,
    isIdle,
    lengthUnit,
    massUnit,
    materialDensity,
    sendModelingCommand,
    volumeUnit,
  ])

  if (!isIdle) {
    return null
  }

  return (
    <div className="flex min-h-0 min-w-64 flex-1 flex-col gap-2 overflow-y-auto p-2 text-chalkboard-100 dark:text-chalkboard-10">
      <div className="grid grid-cols-2 gap-2">
        <UnitSelect
          label="Length"
          testId="physical-analysis-length-unit"
          value={lengthUnit}
          options={unitLengthOptions}
          onChange={(value) =>
            physicalAnalysisService.setPreference('lengthUnit', value)
          }
        />
        <UnitSelect
          label="Area"
          testId="physical-analysis-area-unit"
          value={areaUnit}
          options={unitAreaOptions}
          labels={unitAreaLabels}
          onChange={(value) =>
            physicalAnalysisService.setPreference('areaUnit', value)
          }
        />
        <UnitSelect
          label="Volume"
          testId="physical-analysis-volume-unit"
          value={volumeUnit}
          options={unitVolumeOptions}
          labels={unitVolumeLabels}
          onChange={(value) =>
            physicalAnalysisService.setPreference('volumeUnit', value)
          }
        />
        <UnitSelect
          label="Mass"
          testId="physical-analysis-mass-unit"
          value={massUnit}
          options={unitMassOptions}
          onChange={(value) =>
            physicalAnalysisService.setPreference('massUnit', value)
          }
        />
      </div>

      <div className="grid grid-cols-2 items-end gap-2">
        <label className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[10px] leading-3 text-chalkboard-70 dark:text-chalkboard-40">
            Material density
          </span>
          <input
            data-testid="physical-analysis-density"
            type="number"
            step="any"
            min={0}
            className="w-full rounded-sm border border-chalkboard-30 bg-transparent p-1 text-xs dark:border-chalkboard-80"
            value={densityInput}
            onChange={(event) => setDensityInput(event.target.value)}
          />
        </label>
        <UnitSelect
          label="Density unit"
          testId="physical-analysis-density-unit"
          value={densityUnit}
          options={unitDensityOptions}
          labels={unitDensityLabels}
          onChange={(value) => {
            // An unset density re-seeds from the new unit, so only an
            // explicitly entered value needs converting.
            if (preferences.materialDensity !== null) {
              physicalAnalysisService.setPreference(
                'materialDensity',
                convertMaterialDensity(
                  preferences.materialDensity,
                  densityUnit,
                  value
                )
              )
            }
            physicalAnalysisService.setPreference('densityUnit', value)
          }}
        />
      </div>

      {!isDensityInputValid && (
        <div className="text-xs text-destroy-80">
          Enter a density greater than 0. Showing results for{' '}
          {formatDistance(materialDensity)} {unitDensityLabels[densityUnit]}.
        </div>
      )}

      {status === 'analyzing' && (
        <div className="border-t border-chalkboard-20 pt-2 text-xs text-chalkboard-70 dark:border-chalkboard-80 dark:text-chalkboard-40">
          Analyzing...
        </div>
      )}

      {result && (
        <CopyTextButton
          textToCopy={getPhysicalAnalysisText(
            result,
            materialDensity,
            densityUnit
          )}
          title="Copy physical analysis"
          onCopySuccess={showCopySuccess}
          onCopyError={showCopyError}
          className={`${copyResultsButtonClassName} grid grid-cols-2 gap-3 border-t border-chalkboard-20 pt-2 dark:border-chalkboard-80`}
        >
          <AnalysisValue
            label="Volume"
            value={result.volume}
            unit={unitVolumeLabels[result.volumeUnit]}
          />
          <AnalysisValue
            label="Surface area"
            value={result.surfaceArea}
            unit={unitAreaLabels[result.surfaceAreaUnit]}
          />
          <AnalysisValue
            label="Mass"
            value={result.mass}
            unit={result.massUnit}
          />
          <AnalysisPointValue
            label="CoM"
            point={result.centerOfMass}
            unit={result.centerOfMassUnit}
          />
        </CopyTextButton>
      )}

      {errorMessage && (
        <CopyTextButton
          textToCopy={errorMessage}
          title="Copy physical analysis error"
          onCopySuccess={showCopySuccess}
          onCopyError={showCopyError}
          className={`${copyResultsButtonClassName} whitespace-pre-wrap break-words border-t border-chalkboard-20 pt-2 text-xs text-destroy-80 dark:border-chalkboard-80`}
        >
          <span>{errorMessage}</span>
        </CopyTextButton>
      )}
    </div>
  )
}

export function PhysicalAnalysisDraggablePanel({
  containerRef,
  top,
}: {
  containerRef: RefObject<HTMLElement | null>
  top: number
}) {
  useSignals()

  if (!physicalAnalysisService.isOpen.value) {
    return null
  }

  return (
    <Draggable
      containerRef={containerRef}
      side="top"
      className="pointer-events-auto max-h-[calc(100%-1rem)] max-w-[calc(100%-1rem)] overflow-hidden rounded-md border border-chalkboard-30 bg-chalkboard-10 text-chalkboard-100 shadow-lg dark:border-chalkboard-80 dark:bg-chalkboard-100 dark:text-chalkboard-10"
      data-testid="physical-analysis-draggable-panel"
      style={{
        position: 'absolute',
        // Anchored from the top because CSS resize only grips the bottom
        // right corner; a bottom anchored box grows upward and the grip
        // stops tracking the pointer.
        top,
        left: measurementToolService.isOpen.value ? 344 : panelMargin,
        width: defaultPanelWidth,
        height: defaultPanelHeight,
        minWidth: 280,
        minHeight: 120,
        resize: 'both',
        zIndex: 20,
      }}
      onContextMenu={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      Handle={
        <div className="flex min-h-8 shrink-0 items-center justify-between gap-2 border-b border-chalkboard-30 bg-chalkboard-10 px-2 py-1 dark:border-chalkboard-80 dark:bg-chalkboard-100">
          <div className="flex min-w-0 items-center gap-1.5">
            <CustomIcon
              name="scales"
              className="h-5 w-5 shrink-0 text-chalkboard-70 dark:text-chalkboard-40"
            />
            <span className="truncate text-xs font-medium">
              Physical analysis
            </span>
          </div>
          <button
            type="button"
            className="flex items-center gap-1 rounded-sm px-2 py-1 text-xs text-chalkboard-80 hover:bg-chalkboard-20 focus:bg-chalkboard-20 focus:outline-none dark:text-chalkboard-20 dark:hover:bg-chalkboard-90 dark:focus:bg-chalkboard-90"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => {
              physicalAnalysisService.close()
            }}
          >
            <CustomIcon name="close" className="h-3.5 w-3.5" />
            Close
          </button>
        </div>
      }
    >
      <PhysicalAnalysisTool />
    </Draggable>
  )
}

export function PhysicalAnalysisStatusBarItem() {
  useSignals()
  const [streamElement, setStreamElement] = useState<HTMLElement | null>(null)
  const [panelTop, setPanelTop] = useState(panelMargin)
  const isOpen = physicalAnalysisService.isOpen.value
  const streamContainerRef = useMemo<RefObject<HTMLElement | null>>(
    () => ({ current: streamElement }),
    [streamElement]
  )

  useEffect(() => {
    if (!isOpen) {
      setStreamElement(null)
      return
    }

    const element = document.getElementById('stream')
    setStreamElement(element)

    if (element) {
      // Open near the bottom of the stream, matching where the measure panel
      // sits, without giving up top anchoring.
      setPanelTop(
        Math.max(
          panelMargin,
          element.clientHeight - defaultPanelHeight - panelMargin
        )
      )
    }
  }, [isOpen])

  return (
    <div className="relative">
      <button
        type="button"
        className={defaultStatusBarItemClassNames}
        data-testid="physical-analysis-status"
        aria-expanded={isOpen}
        aria-label="Physical analysis"
        onClick={() => {
          physicalAnalysisService.open()
        }}
      >
        <CustomIcon name="scales" className="h-5 w-5 shrink-0" />
        {!isOpen && (
          <Tooltip wrapperClassName="ui-open:hidden" position="top-right">
            Physical analysis
          </Tooltip>
        )}
      </button>
      {isOpen &&
        streamElement &&
        createPortal(
          <PhysicalAnalysisDraggablePanel
            containerRef={streamContainerRef}
            top={panelTop}
          />,
          streamElement
        )}
    </div>
  )
}
