import decamelize from 'decamelize'
import { Setting } from 'lib/settings/initialSettings'
import { SettingsLevel } from 'lib/settings/settingsTypes'
import { shouldHideSetting } from 'lib/settings/settingsUtils'
import { useSettings } from 'machines/appMachine'

interface SettingsSectionsListProps {
  searchParamTab: SettingsLevel
  scrollRef: React.RefObject<HTMLDivElement>
}

export function SettingsSectionsList({
  searchParamTab,
  scrollRef,
}: SettingsSectionsListProps) {
  const context = useSettings()
  return (
    <div className="flex w-32 flex-col gap-3 pr-2 py-1 border-0 border-r border-r-chalkboard-20 dark:border-r-chalkboard-90">
      {Object.entries(context)
        .filter(([_, categorySettings]) =>
          // Filter out categories that don't have any non-hidden settings
          Object.values(categorySettings).some(
            (setting: Setting) => !shouldHideSetting(setting, searchParamTab)
          )
        )
        .map(([category]) => (
          <button
            key={category}
            onClick={() =>
              scrollRef.current
                ?.querySelector(`#category-${category}`)
                ?.scrollIntoView({
                  block: 'center',
                  behavior: 'smooth',
                })
            }
            className="capitalize text-left border-none px-1"
          >
            {decamelize(category, { separator: ' ' })}
          </button>
        ))}
      <button
        onClick={() =>
          scrollRef.current?.querySelector(`#settings-resets`)?.scrollIntoView({
            block: 'center',
            behavior: 'smooth',
          })
        }
        className="capitalize text-left border-none px-1"
      >
        Resets
      </button>
      <button
        onClick={() =>
          scrollRef.current?.querySelector(`#settings-about`)?.scrollIntoView({
            block: 'center',
            behavior: 'smooth',
          })
        }
        className="capitalize text-left border-none px-1"
      >
        About
      </button>
    </div>
  )
}
