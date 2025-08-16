import { Popover } from '@headlessui/react'
import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'

import {
  changeDefaultUnits,
  unitAngleToUnitAng,
  unitLengthToUnitLen,
} from '@src/lang/wasm'
import { DEFAULT_DEFAULT_LENGTH_UNIT } from '@src/lib/constants'
import { baseUnitLabels, baseUnitsUnion } from '@src/lib/settings/settingsTypes'
import { codeManager, kclManager, sceneInfra } from '@src/lib/singletons'
import { err, reportRejection } from '@src/lib/trap'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { OrthographicCamera } from 'three'

export function UnitsMenu() {
  const [fileSettings, setFileSettings] = useState(kclManager.fileSettings)
  const { state: modelingState } = useModelingContext()
  const inSketchMode = modelingState.matches('Sketch')

  const [rulerWidth, setRulerWidth] = useState<number>(16)
  const [rulerLabelValue, setRulerLabelValue] = useState<number>(1)

  const currentUnit =
    fileSettings.defaultLengthUnit ?? DEFAULT_DEFAULT_LENGTH_UNIT

  const onCameraChange = useCallback(() => {
    if (!inSketchMode) {
      return
    }
    const camera = sceneInfra.camControls.camera
    if (!(camera instanceof OrthographicCamera)) {
      console.error(
        'Camera is not an OrthographicCamera, skipping ruler recalculation'
      )
      return
    }

    let rulerWidth = sceneInfra.getPixelsPerBaseUnit(camera)
    let displayValue = 1

    if (rulerWidth > 150 || rulerWidth < 20) {
      const k = Math.ceil(Math.log10(rulerWidth / 150))
      rulerWidth /= Math.pow(10, k)
      displayValue = 1 / Math.pow(10, k)
      if (k < 0) {
        displayValue = Math.round(displayValue) // 1e5 would become something like 1.0000000000000001e+5 without this
      }
    }
    setRulerWidth(rulerWidth)
    setRulerLabelValue(displayValue)
  }, [inSketchMode])

  useEffect(() => {
    const unsubscribe =
      sceneInfra.camControls.subscribeToCamChange(onCameraChange)
    onCameraChange()
    return () => {
      unsubscribe()
    }
  }, [onCameraChange])
  useEffect(() => {
    setFileSettings(kclManager.fileSettings)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [kclManager.fileSettings])

  return (
    <Popover className="relative pointer-events-auto">
      {({ close }) => (
        <>
          <Popover.Button
            data-testid="units-menu"
            className={`flex items-center gap-2 px-3 py-1 
        text-xs text-primary bg-chalkboard-10/70 dark:bg-chalkboard-100/80 backdrop-blur-sm 
        border !border-primary/50 rounded-full`}
          >
            <div
              className="w-4 h-[1px] bg-primary relative"
              style={{ width: inSketchMode ? `${rulerWidth}px` : '' }}
            >
              <div className="absolute w-[1px] h-[1em] bg-primary left-0 top-1/2 -translate-y-1/2"></div>
              <div className="absolute w-[1px] h-[1em] bg-primary right-0 top-1/2 -translate-y-1/2"></div>
            </div>
            <span className="sr-only">Current units are:&nbsp;</span>
            {inSketchMode
              ? `${rulerLabelValue > 10000 || rulerLabelValue < 0.0001 ? rulerLabelValue.toExponential() : rulerLabelValue.toString()}${currentUnit}`
              : currentUnit}
          </Popover.Button>
          <Popover.Panel
            className={`absolute bottom-full right-0 mb-2 w-48 bg-chalkboard-10 dark:bg-chalkboard-90
          border border-solid border-chalkboard-10 dark:border-chalkboard-90 rounded
          shadow-lg`}
          >
            <ul className="relative flex flex-col items-stretch content-stretch p-0.5">
              {baseUnitsUnion.map((unit) => (
                <li key={unit} className="contents">
                  <button
                    className="flex items-center gap-2 m-0 py-1.5 px-2 cursor-pointer hover:bg-chalkboard-20 dark:hover:bg-chalkboard-80 border-none text-left"
                    onClick={() => {
                      const newCode = changeDefaultUnits(
                        codeManager.code,
                        unitLengthToUnitLen(unit),
                        unitAngleToUnitAng(undefined)
                      )
                      if (err(newCode)) {
                        toast.error(
                          `Failed to set per-file units: ${newCode.message}`
                        )
                      } else {
                        codeManager.updateCodeStateEditor(newCode)
                        Promise.all([
                          codeManager.writeToFile(),
                          kclManager.executeCode(),
                        ])
                          .then(() => {
                            toast.success(`Updated per-file units to ${unit}`)
                          })
                          .catch(reportRejection)
                      }
                      close()
                    }}
                  >
                    <span className="flex-1">{baseUnitLabels[unit]}</span>
                    {unit ===
                      (fileSettings.defaultLengthUnit ??
                        DEFAULT_DEFAULT_LENGTH_UNIT) && (
                      <span className="text-chalkboard-60">current</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </Popover.Panel>
        </>
      )}
    </Popover>
  )
}
