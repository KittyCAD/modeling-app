import { Link } from 'react-router-dom'
import { ActionIcon, ActionIconProps } from './ActionIcon'
import React from 'react'

interface ActionButtonProps extends React.PropsWithChildren {
  icon?: ActionIconProps
  className?: string
  onClick?: () => void
  to?: string
  Element?:
    | 'button'
    | 'link'
    | React.ComponentType<React.HTMLAttributes<HTMLButtonElement>>
}

export const ActionButton = ({
  icon,
  className,
  onClick,
  to = '/',
  Element = 'button',
  children,
  ...props
}: ActionButtonProps) => {
  const classNames = `group mono text-base flex items-center gap-2 rounded-sm border border-chalkboard-40 dark:border-chalkboard-60 hover:border-liquid-40 dark:hover:bg-chalkboard-90 p-[3px] text-chalkboard-110 dark:text-chalkboard-10 hover:text-chalkboard-110 hover:dark:text-chalkboard-10 ${
    icon ? 'pr-2' : 'px-2'
  } ${className}`

  if (Element === 'button') {
    return (
      <button onClick={onClick} className={classNames} {...props}>
        {icon && <ActionIcon {...icon} />}
        {children}
      </button>
    )
  } else if (Element === 'link') {
    return (
      <Link to={to} className={classNames} {...props}>
        {icon && <ActionIcon {...icon} />}
        {children}
      </Link>
    )
  } else {
    return (
      <Element onClick={onClick} className={classNames} {...props}>
        {icon && <ActionIcon {...icon} />}
        {children}
      </Element>
    )
  }
}
