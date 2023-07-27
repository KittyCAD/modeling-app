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
}: ActionButtonProps) => {
  const classNames = `group mono flex items-center gap-2 text-chalkboard-110 rounded-sm border border-chalkboard-40 hover:border-liquid-40 p-[3px] ${
    icon ? 'pr-2' : 'px-2'
  } ${className}`

  if (Element === 'button') {
    return (
      <button onClick={onClick} className={classNames}>
        {icon && <ActionIcon {...icon} />}
        {children}
      </button>
    )
  } else if (Element === 'link') {
    return (
      <Link to={to} className={classNames}>
        {icon && <ActionIcon {...icon} />}
        {children}
      </Link>
    )
  } else {
    return (
      <Element onClick={onClick} className={classNames}>
        {icon && <ActionIcon {...icon} />}
        {children}
      </Element>
    )
  }
}
