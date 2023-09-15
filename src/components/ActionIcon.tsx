import {
  IconDefinition as SolidIconDefinition,
  faCircleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import { IconDefinition as BrandIconDefinition } from '@fortawesome/free-brands-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { CustomIcon, CustomIconName } from './CustomIcon'

const iconSizes = {
  sm: 12,
  md: 14.4,
  lg: 20,
  xl: 28,
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
  const computedIconClassName =
    iconClassName ||
    `text-liquid-20 h-auto group-hover:text-liquid-10 hover:text-liquid-10 dark:text-chalkboard-100 dark:group-hover:text-chalkboard-100 dark:hover:text-chalkboard-100`

  const computedBgClassName =
    bgClassName ||
    `bg-chalkboard-100 group-hover:bg-chalkboard-90 hover:bg-chalkboard-90 dark:bg-liquid-20 dark:group-hover:bg-liquid-10 dark:hover:bg-liquid-10 group-disabled:bg-chalkboard-50`

  return (
    <div
      className={
        `p-${
          size === 'xl' ? '2' : '1'
        } w-fit inline-grid place-content-center ${className} ` +
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
