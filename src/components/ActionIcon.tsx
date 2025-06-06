import type { IconDefinition } from '@fortawesome/free-solid-svg-icons'
import { faCircleExclamation } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

import type { CustomIconName } from '@src/components/CustomIcon'
import { CustomIcon } from '@src/components/CustomIcon'

const iconSizes = {
  xs: 12,
  sm: 14,
  md: 20,
  lg: 24,
}

export interface ActionIconProps extends React.PropsWithChildren {
  icon?: IconDefinition | CustomIconName
  iconColor?: string
  className?: string
  bgClassName?: string
  iconClassName?: string
  size?: keyof typeof iconSizes
  'data-testid'?: string
}

export const ActionIcon = (props: ActionIconProps) => {
  const {
    icon = faCircleExclamation,
    iconColor,
    className,
    bgClassName,
    iconClassName,
    size = 'md',
    children,
  } = props

  const computedIconClassName = `h-auto text-inherit dark:text-current group-disabled:text-chalkboard-60 group-disabled:text-chalkboard-60 ${iconClassName}`
  const computedBgClassName = `bg-chalkboard-20 dark:bg-chalkboard-80 group-disabled:bg-chalkboard-30 dark:group-disabled:bg-chalkboard-80 ${bgClassName}`

  return (
    <span style={{ display: 'contents', color: iconColor }}>
      <div
        data-testid={props['data-testid']}
        className={
          `w-fit self-stretch inline-grid place-content-center ${className} ` +
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
    </span>
  )
}
