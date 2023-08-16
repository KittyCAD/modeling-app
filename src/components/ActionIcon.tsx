import {
  IconDefinition as SolidIconDefinition,
  faCircleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import { IconDefinition as BrandIconDefinition } from '@fortawesome/free-brands-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

const iconSizes = {
  sm: 12,
  md: 14.4,
  lg: 18,
}

export interface ActionIconProps extends React.PropsWithChildren {
  icon?: SolidIconDefinition | BrandIconDefinition
  bgClassName?: string
  iconClassName?: string
  size?: keyof typeof iconSizes
}

export const ActionIcon = ({
  icon = faCircleExclamation,
  bgClassName,
  iconClassName,
  size = 'md',
  children,
}: ActionIconProps) => {
  return (
    <div
      className={
        'p-1 w-fit inline-grid place-content-center ' +
        (bgClassName ||
          'bg-chalkboard-100 group-hover:bg-chalkboard-90 hover:bg-chalkboard-90 dark:bg-liquid-20 dark:group-hover:bg-liquid-10 dark:hover:bg-liquid-10')
      }
    >
      {children || (
        <FontAwesomeIcon
          icon={icon}
          width={iconSizes[size]}
          height={iconSizes[size]}
          className={
            iconClassName ||
            'text-liquid-20 group-hover:text-liquid-10 hover:text-liquid-10 dark:text-liquid-100 dark:group-hover:text-liquid-100 dark:hover:text-liquid-100'
          }
        />
      )}
    </div>
  )
}
