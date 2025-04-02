import type { CustomIconName } from '@src/components/CustomIcon'
import { CustomIcon } from '@src/components/CustomIcon'

interface SettingsTabButtonProps {
  checked: boolean
  icon: CustomIconName
  text: string
}

export function SettingsTabButton(props: SettingsTabButtonProps) {
  const { checked, icon, text } = props
  return (
    <div
      className={`cursor-pointer select-none flex items-center gap-1 p-1 pr-2 -mb-[1px] border-0 border-b ${
        checked
          ? 'border-primary'
          : 'border-chalkboard-20 dark:border-chalkboard-30 hover:bg-primary/20 dark:hover:bg-primary/50'
      }`}
    >
      <CustomIcon
        name={icon}
        className={
          'w-5 h-5 ' + (checked ? 'bg-primary !text-chalkboard-10' : '')
        }
      />
      <span>{text}</span>
    </div>
  )
}
