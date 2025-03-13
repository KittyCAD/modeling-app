import { Popover } from '@headlessui/react'
import {
  changeKclSettings,
  DEFAULT_DEFAULT_ANGLE_UNIT,
  unitAngleToUnitAng,
  unitLengthToUnitLen,
} from 'lang/wasm'
import {
  baseUnitLabels,
  baseUnitsUnion,
  DEFAULT_DEFAULT_LENGTH_UNIT,
} from 'lib/settings/settingsTypes'
import { codeManager, kclManager } from 'lib/singletons'
import { err, reportRejection } from 'lib/trap'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'

export function UnitsMenu() {
  const [hasPerFileLengthUnit, setHasPerFileLengthUnit] = useState(
    Boolean(kclManager.fileSettings.defaultLengthUnit)
  )
  const [lengthSetting, setLengthSetting] = useState(
    kclManager.fileSettings.defaultLengthUnit || DEFAULT_DEFAULT_LENGTH_UNIT
  )
  useEffect(() => {
    setHasPerFileLengthUnit(Boolean(kclManager.fileSettings.defaultLengthUnit))
    setLengthSetting(
      kclManager.fileSettings.defaultLengthUnit || DEFAULT_DEFAULT_LENGTH_UNIT
    )
  }, [kclManager.fileSettings.defaultLengthUnit, DEFAULT_DEFAULT_LENGTH_UNIT])

  return (
    <Popover className="relative pointer-events-auto">
      {({ close }) => (
        <>
          <Popover.Button
            className={`flex items-center gap-2 px-3 py-1 
        text-xs text-primary bg-chalkboard-10/70 dark:bg-chalkboard-100/80 backdrop-blur-sm 
        border !border-primary/50 rounded-full`}
          >
            <div className="w-4 h-[1px] bg-primary relative">
              <div className="absolute w-[1px] h-[1em] bg-primary left-0 top-1/2 -translate-y-1/2"></div>
              <div className="absolute w-[1px] h-[1em] bg-primary right-0 top-1/2 -translate-y-1/2"></div>
            </div>
            <span className="sr-only">Current units are:&nbsp;</span>
            {lengthSetting}
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
                      const newCode = changeKclSettings(codeManager.code, {
                        defaultLengthUnits: unitLengthToUnitLen(unit),
                        defaultAngleUnits: unitAngleToUnitAng(
                          DEFAULT_DEFAULT_ANGLE_UNIT
                        ),
                        stdPath: null,
                      })
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
                    {unit === lengthSetting && (
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
