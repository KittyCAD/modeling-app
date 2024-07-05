import { Popover } from '@headlessui/react'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { baseUnitLabels, baseUnitsUnion } from 'lib/settings/settingsTypes'

export function UnitsMenu() {
  const { settings } = useSettingsAuthContext()
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
            {settings.context.modeling.defaultUnit.current}
          </Popover.Button>
          <Popover.Panel
            className={`absolute bottom-full right-0 mb-2 w-48 bg-chalkboard-10 dark:bg-chalkboard-90
          border border-solid border-chalkboard-10 dark:border-chalkboard-90 rounded
          shadow-lg`}
          >
            <ul className="relative flex flex-col gap-0.5 items-stretch content-stretch">
              {baseUnitsUnion.map((unit) => (
                <li key={unit} className="contents">
                  <button
                    className="flex items-center gap-2 py-1 px-2 cursor-pointer hover:bg-chalkboard-20 dark:hover:bg-chalkboard-80 border-none text-left"
                    onClick={() => {
                      settings.send({
                        type: 'set.modeling.defaultUnit',
                        data: {
                          level: 'project',
                          value: unit,
                        },
                      })
                      close()
                    }}
                  >
                    {baseUnitLabels[unit]}
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
