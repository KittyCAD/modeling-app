import type { ForwardedRef } from 'react'
import React, { forwardRef } from 'react'
import type { LinkProps } from 'react-router-dom'
import { Link } from 'react-router-dom'

import type { ActionIconProps } from '@src/components/ActionIcon'
import { ActionIcon } from '@src/components/ActionIcon'
import { getActionButtonClasses } from '@src/components/actionButtonStyles'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import { PATHS } from '@src/lib/routePaths'

interface BaseActionButtonProps {
  iconStart?: ActionIconProps
  iconEnd?: ActionIconProps
  className?: string
  htmlFor?: string
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
  Omit<
    React.AnchorHTMLAttributes<HTMLAnchorElement>,
    keyof BaseActionButtonProps | 'href'
  > & {
    Element: 'externalLink'
    to: string
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
  const classNames = getActionButtonClasses({
    hasIconStart: Boolean(props.iconStart),
    hasIconEnd: Boolean(props.iconEnd),
    className: props.className,
  })

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
          htmlFor={props.htmlFor}
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
        <a
          ref={ref as ForwardedRef<HTMLAnchorElement>}
          href={to || PATHS.INDEX}
          className={classNames}
          onClick={openExternalBrowserIfDesktop(to)}
          {...rest}
          target="_blank"
        >
          {iconStart && <ActionIcon {...iconStart} />}
          {children}
          {iconEnd && <ActionIcon {...iconEnd} />}
        </a>
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
