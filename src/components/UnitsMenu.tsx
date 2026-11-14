import { UnitsMenuView } from '@src/components/UnitsMenuView'
import { use, useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'

import { useModelingContext } from '@src/hooks/useModelingContext'
import { changeDefaultUnits } from '@src/lang/wasm'
import { useSingletons } from '@src/lib/boot'
import { DEFAULT_DEFAULT_LENGTH_UNIT } from '@src/lib/constants'
import { err } from '@src/lib/trap'
import { OrthographicCamera } from 'three'

export function UnitsMenu() {
  const { kclManager } = useSingletons()
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
    const camera = kclManager.sceneInfra.camControls.camera
    if (!(camera instanceof OrthographicCamera)) {
      console.error(
        'Camera is not an OrthographicCamera, skipping ruler recalculation'
      )
      return
    }

    let rulerWidth = kclManager.sceneInfra.getPixelsPerBaseUnit(camera)
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
  }, [inSketchMode, kclManager.sceneInfra])

  useEffect(() => {
    const unsubscribers = [
      kclManager.sceneInfra.camControls.cameraChange.add(onCameraChange),
      kclManager.sceneInfra.baseUnitChange.add(onCameraChange),
    ]
    onCameraChange()
    return () => {
      unsubscribers.forEach((unsubscriber) => unsubscriber())
    }
  }, [
    onCameraChange,
    kclManager.sceneInfra.baseUnitChange,
    kclManager.sceneInfra.camControls.cameraChange,
  ])
  useEffect(() => {
    setFileSettings(kclManager.fileSettings)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [
    kclManager.fileSettings,
    kclManager.sceneInfra.baseUnitChange,
    kclManager.sceneInfra.camControls.cameraChange,
  ])

  return (
    <UnitsMenuView
      currentUnit={currentUnit}
      inSketchMode={inSketchMode}
      rulerWidth={rulerWidth}
      rulerLabelValue={rulerLabelValue}
      onUnitChange={(unit) => {
        const newCode = changeDefaultUnits(kclManager.code, unit, wasmInstance)
        if (err(newCode)) {
          toast.error(`Failed to set per-file units: ${newCode.message}`)
        } else {
          kclManager.updateCodeEditor(newCode, {
            shouldExecute: true,
            shouldResetCamera: true,
          })
          toast.success(`Updated per-file units to ${unit}.`)
        }
      }}
    />
  )
}
