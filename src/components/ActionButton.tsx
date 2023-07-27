import { Link } from 'react-router-dom'
import { ActionIcon, ActionIconProps } from './ActionIcon'

interface ActionButtonProps extends React.PropsWithChildren {
  icon?: ActionIconProps
  className?: string
  onClick?: () => void
  to?: string
  as?: 'button' | 'link'
}

export const ActionButton = ({
  icon,
  className,
  onClick,
  to = '/',
  as = 'button',
  children,
}: ActionButtonProps) => {
  const classNames = `group mono text-base flex items-center gap-2 rounded-sm border border-chalkboard-40 dark:border-chalkboard-60 hover:border-liquid-40 p-[3px] ${
    icon ? 'pr-2' : 'px-2'
  } ${className}`

  return as === 'button' ? (
    <button onClick={onClick} className={classNames}>
      {icon && <ActionIcon {...icon} />}
      {children}
    </button>
  ) : (
    <Link to={to} className={classNames}>
      {icon && <ActionIcon {...icon} />}
      {children}
    </Link>
  )
}
