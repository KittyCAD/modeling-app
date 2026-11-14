import type { UnitLength } from '@kittycad/lib'
import { Popover } from '@headlessui/react'
import { defaultStatusBarItemClassNames } from '@src/components/StatusBar/StatusBar'
import Tooltip from '@src/components/Tooltip'
import { baseUnitLabels, baseUnitsUnion } from '@src/lib/settings/settingsTypes'
/** File-route and editor-view hosts supply unit state and mutation separately. */
export function UnitsMenuView({
  currentUnit,
  onUnitChange,
  disabled = false,
  inSketchMode = false,
  rulerWidth = 16,
  rulerLabelValue = 1,
}: {
  currentUnit: UnitLength
  onUnitChange: (unit: UnitLength) => void
  disabled?: boolean
  inSketchMode?: boolean
  rulerWidth?: number
  rulerLabelValue?: number
}) {
  return (
    <Popover className="relative pointer-events-auto flex">
      {(popover) => (
        <>
          <Popover.Button
            data-testid="units-menu"
            aria-label="File units"
            disabled={disabled}
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
                      onUnitChange(unit)
                      popover.close()
                    }}
                  >
                    <span className="flex-1">{baseUnitLabels[unit]}</span>
                    {unit === currentUnit && (
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
