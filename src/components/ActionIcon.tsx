import {
  IconDefinition as SolidIconDefinition,
  faCircleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import { IconDefinition as BrandIconDefinition } from '@fortawesome/free-brands-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { CustomIcon, CustomIconName } from './CustomIcon'

const iconSizes = {
  sm: 12,
  md: 20,
  lg: 24,
}

export interface ActionIconProps extends React.PropsWithChildren {
  icon?: SolidIconDefinition | BrandIconDefinition | CustomIconName
  className?: string
  bgClassName?: string
  iconClassName?: string
  size?: keyof typeof iconSizes
}

export const ActionIcon = ({
  icon = faCircleExclamation,
  className,
  bgClassName,
  iconClassName,
  size = 'md',
  children,
}: ActionIconProps) => {
  // By default, we reverse the icon color and background color in dark mode
  const computedIconClassName = `h-auto dark:text-chalkboard-100 !group-disabled:text-chalkboard-60 !group-disabled:text-chalkboard-60 ${iconClassName}`

  const computedBgClassName = `bg-chalkboard-20 dark:bg-liquid-20 !group-disabled:bg-chalkboard-30 !dark:group-disabled:bg-chalkboard-80 ${bgClassName}`

  return (
    <div
      className={
        `w-fit inline-grid place-content-center ${className} ` +
        computedBgClassName
      }
    >
      {children ? (
        children
      ) : typeof icon === 'string' ? (
        <CustomIcon
          name={icon}
          width={iconSizes[size]}
          height={iconSizes[size]}
          className={computedIconClassName}
        />
      ) : (
        <FontAwesomeIcon
          icon={icon}
          width={iconSizes[size]}
          height={iconSizes[size]}
          className={computedIconClassName}
        />
      )}
    </div>
  )
}
