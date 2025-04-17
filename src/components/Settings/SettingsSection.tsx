import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import type { SettingsLevel } from '@src/lib/settings/settingsTypes'

interface SettingsSectionProps extends React.HTMLProps<HTMLDivElement> {
  title: string
  description?: string
  className?: string
  parentLevel?: SettingsLevel | 'default'
  onFallback?: () => void
  settingHasChanged?: boolean
  headingClassName?: string
}

export function SettingsSection({
  title,
  id,
  description,
  className,
  children,
  parentLevel,
  settingHasChanged,
  onFallback,
  headingClassName = 'text-lg font-normal capitalize tracking-wide',
}: SettingsSectionProps) {
  return (
    <section
      id={id}
      className={
        'group p-2 pl-0 grid grid-cols-2 gap-6 items-start ' +
        className +
        (settingHasChanged ? ' border-0 border-l-2 -ml-0.5 border-primary' : '')
      }
    >
      <div className="ml-2">
        <div className="flex items-center gap-2">
          <h2 className={headingClassName}>{title}</h2>
          {onFallback && parentLevel && settingHasChanged && (
            <button
              onClick={onFallback}
              className="hidden group-hover:block group-focus-within:block border-none p-0 hover:bg-warn-10 dark:hover:bg-warn-80 focus:bg-warn-10 dark:focus:bg-warn-80 focus:outline-none"
            >
              <CustomIcon name="refresh" className="w-4 h-4" />
              <span className="sr-only">Roll back {title}</span>
              <Tooltip position="right">
                Roll back to match {parentLevel}
              </Tooltip>
            </button>
          )}
        </div>
        {description && (
          <p className="mt-2 text-xs text-chalkboard-80 dark:text-chalkboard-30">
            {description}
          </p>
        )}
      </div>
      <div>{children}</div>
    </section>
  )
}
