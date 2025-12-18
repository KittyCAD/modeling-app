import decamelize from 'decamelize'

import type { SettingsLevel } from '@src/lib/settings/settingsTypes'
import { shouldHideSettingSync } from '@src/lib/settings/settingsUtils'
import { useSettings } from '@src/lib/singletons'

interface SettingsSectionsListProps {
  searchParamTab: SettingsLevel
  scrollRef: React.RefObject<HTMLDivElement | null>
}

export function SettingsSectionsList({
  searchParamTab,
  scrollRef,
}: SettingsSectionsListProps) {
  const context = useSettings()

  const visibleCategories = Object.entries(context).filter(
    ([_, categorySettings]) =>
      // Filter out categories that don't have any non-hidden settings
      Object.values(categorySettings).some(
        (setting) => !shouldHideSettingSync(setting, searchParamTab)
      )
  )

  return (
    <div className="flex w-32 flex-col gap-3 pr-2 py-1 border-0 border-r border-r-chalkboard-20 dark:border-r-chalkboard-90">
      {visibleCategories.map(([category]) => (
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
