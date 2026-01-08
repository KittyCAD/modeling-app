import { Popover } from '@headlessui/react'
import { use, useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'

import { useModelingContext } from '@src/hooks/useModelingContext'
import { changeDefaultUnits } from '@src/lang/wasm'
import { DEFAULT_DEFAULT_LENGTH_UNIT } from '@src/lib/constants'
import { baseUnitLabels, baseUnitsUnion } from '@src/lib/settings/settingsTypes'
import { kclManager, sceneInfra } from '@src/lib/singletons'
import { err, reportRejection } from '@src/lib/trap'
import { OrthographicCamera } from 'three'
import { defaultStatusBarItemClassNames } from '@src/components/StatusBar/StatusBar'
import Tooltip from '@src/components/Tooltip'

export function UnitsMenu() {
  const wasmInstance = use(kclManager.wasmInstancePromise)
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
    const unsubscribers = [
      sceneInfra.camControls.cameraChange.add(onCameraChange),
      sceneInfra.baseUnitChange.add(onCameraChange),
    ]
    onCameraChange()
    return () => {
      unsubscribers.forEach((unsubscriber) => unsubscriber())
    }
  }, [onCameraChange])
  useEffect(() => {
    setFileSettings(kclManager.fileSettings)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [kclManager.fileSettings])

  return (
    <Popover className="relative pointer-events-auto flex">
      {(popover) => (
        <>
          <Popover.Button
            data-testid="units-menu"
            className={`${defaultStatusBarItemClassNames} gap-2 m-0`}
          >
            <div
              className="w-4 h-[1px] bg-5 relative"
              style={{ width: inSketchMode ? `${rulerWidth}px` : '' }}
            >
              <div className="absolute w-[1px] h-[1em] bg-5 left-0 top-1/2 -translate-y-1/2"></div>
              <div className="absolute w-[1px] h-[1em] bg-5 right-0 top-1/2 -translate-y-1/2"></div>
            </div>
            <Tooltip hoverOnly={true} position="top-right">
              Default units for current file
            </Tooltip>
            {inSketchMode
              ? `${rulerLabelValue > 10000 || rulerLabelValue < 0.0001 ? rulerLabelValue.toExponential() : rulerLabelValue.toString()}${currentUnit}`
              : currentUnit}
          </Popover.Button>
          <Popover.Panel
            className={`z-10 absolute bottom-full right-0 mb-1 p-1 w-52 bg-chalkboard-10 dark:bg-chalkboard-90
          border border-solid border-chalkboard-20 dark:border-chalkboard-90 rounded
          shadow-lg`}
          >
            <ul className="flex flex-col items-stretch content-stretch p-0.5">
              {baseUnitsUnion.map((unit) => (
                <li key={unit} className="contents">
                  <button
                    className="flex items-center gap-2 m-0 py-1.5 px-2 cursor-pointer hover:bg-chalkboard-20 dark:hover:bg-chalkboard-80 border-none text-left"
                    onClick={() => {
                      const newCode = changeDefaultUnits(
                        kclManager.code,
                        unit,
                        wasmInstance
                      )
                      if (err(newCode)) {
                        toast.error(
                          `Failed to set per-file units: ${newCode.message}`
                        )
                      } else {
                        kclManager.updateCodeEditor(newCode)
                        Promise.all([
                          kclManager.writeToFile(),
                          kclManager.executeCode(),
                        ])
                          .then(() => {
                            toast.success(`Updated per-file units to ${unit}`)
                          })
                          .catch(reportRejection)
                      }
                      popover.close()
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
