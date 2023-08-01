import { IconDefinition } from '@fortawesome/free-solid-svg-icons'
import { ActionIcon } from './ActionIcon'

export const PanelHeader = ({
  title,
  icon,
}: {
  title: string
  icon?: IconDefinition
}) => {
  return (
    <div className="flex items-center gap-2 font-mono text-xs bg-chalkboard-20 dark:bg-chalkboard-110 dark:border-b-2 dark:border-b-chalkboard-90 w-full p-2">
      <ActionIcon
        icon={icon}
        bgClassName="bg-chalkboard-30 dark:bg-chalkboard-90"
        iconClassName="text-chalkboard-90 dark:text-chalkboard-40"
      />
      <span className="pt-1">{title}</span>
    </div>
  )
}
