import type { ForwardedRef } from 'react'
import React, { forwardRef } from 'react'
import type { LinkProps } from 'react-router-dom'
import { Link } from 'react-router-dom'

import type { ActionIconProps } from '@src/components/ActionIcon'
import { ActionIcon } from '@src/components/ActionIcon'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import { PATHS } from '@src/lib/paths'

interface BaseActionButtonProps {
  iconStart?: ActionIconProps
  iconEnd?: ActionIconProps
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

export type ActionButtonProps =
  | ActionButtonAsButton
  | ActionButtonAsLink
  | ActionButtonAsExternal
  | ActionButtonAsElement

export const ActionButton = forwardRef((props: ActionButtonProps, ref) => {
  const classNames = `action-button p-0 m-0 group mono text-xs leading-none flex items-center gap-2 rounded-sm border-solid border border-chalkboard-30 hover:border-chalkboard-40 enabled:dark:border-chalkboard-70 dark:hover:border-chalkboard-60 dark:bg-chalkboard-90/50 text-chalkboard-100 dark:text-chalkboard-10 ${
    props.iconStart
      ? props.iconEnd
        ? 'px-0' // No padding if both icons are present
        : 'pr-2' // Padding on the right if only the start icon is present
      : props.iconEnd
        ? 'pl-2' // Padding on the left if only the end icon is present
        : 'px-2' // Padding on both sides if no icons are present
  } ${props.className ? props.className : ''}`

  switch (props.Element) {
    case 'button': {
      // Note we have to destructure 'className' and 'Element' out of props
      // because we don't want to pass them to the button element;
      // the same is true for the other cases below.
      const {
        Element,
        iconStart,
        iconEnd,
        children,
        className: _className,
        ...rest
      } = props
      return (
        <button
          ref={ref as ForwardedRef<HTMLButtonElement>}
          className={classNames}
          tabIndex={-1}
          {...rest}
        >
          {iconStart && <ActionIcon {...iconStart} />}
          {children}
          {iconEnd && <ActionIcon {...iconEnd} />}
        </button>
      )
    }
    case 'link': {
      const {
        Element,
        to,
        iconStart,
        iconEnd,
        children,
        className: _className,
        ...rest
      } = props
      return (
        <Link
          ref={ref as ForwardedRef<HTMLAnchorElement>}
          to={to || PATHS.INDEX}
          className={classNames}
          {...rest}
        >
          {iconStart && <ActionIcon {...iconStart} />}
          {children}
          {iconEnd && <ActionIcon {...iconEnd} />}
        </Link>
      )
    }
    case 'externalLink': {
      const {
        Element,
        to,
        iconStart,
        iconEnd,
        children,
        className: _className,
        ...rest
      } = props
      return (
        <Link
          ref={ref as ForwardedRef<HTMLAnchorElement>}
          to={to || PATHS.INDEX}
          className={classNames}
          onClick={openExternalBrowserIfDesktop(to as string)}
          {...rest}
          target="_blank"
        >
          {iconStart && <ActionIcon {...iconStart} />}
          {children}
          {iconEnd && <ActionIcon {...iconEnd} />}
        </Link>
      )
    }
    default: {
      const {
        Element,
        iconStart,
        children,
        className: _className,
        ...rest
      } = props

      return (
        <Element className={classNames} {...rest}>
          {props.iconStart && <ActionIcon {...props.iconStart} />}
          {children}
          {props.iconEnd && <ActionIcon {...props.iconEnd} />}
        </Element>
      )
    }
  }
})
