import { ActionIcon, ActionIconProps } from './ActionIcon'
import React from 'react'
import { paths } from 'lib/paths'
import { Link } from 'react-router-dom'
import type { LinkProps } from 'react-router-dom'

interface BaseActionButtonProps {
  icon?: ActionIconProps
  className?: string
}

type ActionButtonAsButton = BaseActionButtonProps &
  Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    keyof BaseActionButtonProps
  > & {
    Element: 'button'
  }

type ActionButtonAsLink = BaseActionButtonProps &
  Omit<LinkProps, keyof BaseActionButtonProps> & {
    Element: 'link'
  }

type ActionButtonAsExternal = BaseActionButtonProps &
  Omit<LinkProps, keyof BaseActionButtonProps> & {
    Element: 'externalLink'
  }

type ActionButtonAsElement = BaseActionButtonProps &
  Omit<React.HTMLAttributes<HTMLElement>, keyof BaseActionButtonProps> & {
    Element: React.ComponentType<React.HTMLAttributes<HTMLButtonElement>>
  }

type ActionButtonProps =
  | ActionButtonAsButton
  | ActionButtonAsLink
  | ActionButtonAsExternal
  | ActionButtonAsElement

export const ActionButton = (props: ActionButtonProps) => {
  const classNames = `action-button m-0 group mono text-sm flex items-center gap-2 rounded-sm border-solid border border-chalkboard-30 hover:border-chalkboard-40 dark:border-chalkboard-70 dark:hover:border-chalkboard-60 dark:bg-chalkboard-90/50 p-[3px] text-chalkboard-100 dark:text-chalkboard-10 ${
    props.icon ? 'pr-2' : 'px-2'
  } ${props.className ? props.className : ''}`

  switch (props.Element) {
    case 'button': {
      // Note we have to destructure 'className' and 'Element' out of props
      // because we don't want to pass them to the button element;
      // the same is true for the other cases below.
      const { Element, icon, children, className: _className, ...rest } = props
      return (
        <button className={classNames} {...rest}>
          {props.icon && <ActionIcon {...icon} disabled={rest.disabled} />}
          {children}
        </button>
      )
    }
    case 'link': {
      const {
        Element,
        to,
        icon,
        children,
        className: _className,
        ...rest
      } = props
      return (
        <Link to={to || paths.INDEX} className={classNames} {...rest}>
          {icon && <ActionIcon {...icon} />}
          {children}
        </Link>
      )
    }
    case 'externalLink': {
      const {
        Element,
        to,
        icon,
        children,
        className: _className,
        ...rest
      } = props
      return (
        <Link
          to={to || paths.INDEX}
          className={classNames}
          {...rest}
          target="_blank"
        >
          {icon && <ActionIcon {...icon} />}
          {children}
        </Link>
      )
    }
    default: {
      const { Element, icon, children, className: _className, ...rest } = props
      if (!Element) throw new Error('Element is required')

      return (
        <Element className={classNames} {...rest}>
          {props.icon && <ActionIcon {...props.icon} />}
          {children}
        </Element>
      )
    }
  }
}
