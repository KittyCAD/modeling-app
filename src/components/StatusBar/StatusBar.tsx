import { ActionButton } from '@src/components/ActionButton'
import type { StatusBarItemType } from '@src/components/StatusBar/statusBarTypes'
import Tooltip, { type TooltipProps } from '@src/components/Tooltip'
import { ActionIcon } from '@src/components/ActionIcon'
import { Popover } from '@headlessui/react'
import { EnvironmentChipDevelopment } from '@src/components/environment/Banner'

export function StatusBar({
  globalItems,
  localItems,
}: {
  globalItems: StatusBarItemType[]
  localItems: StatusBarItemType[]
}) {
  return (
    <footer
      id="statusbar"
      className="relative z-10 flex justify-between items-center bg-chalkboard-20 dark:bg-chalkboard-90 text-chalkboard-80 dark:text-chalkboard-30 border-t border-t-chalkboard-30 dark:border-t-chalkboard-80"
    >
      <menu id="statusbar-globals" className="flex items-stretch">
        {globalItems.map((item) => (
          <StatusBarItem key={item.id} {...item} position="left" />
        ))}
      </menu>
      <menu id="statusbar-locals" className="flex items-stretch">
        <EnvironmentChipDevelopment className=""></EnvironmentChipDevelopment>
        {localItems.map((item) => (
          <StatusBarItem key={item.id} {...item} position="right" />
        ))}
      </menu>
    </footer>
  )
}

function StatusBarItem(
  props: StatusBarItemType & { position: 'left' | 'middle' | 'right' }
) {
  const defaultClassNames =
    'flex items-center px-2 py-1 text-xs text-chalkboard-80 dark:text-chalkboard-30 rounded-none border-none hover:bg-chalkboard-30 dark:hover:bg-chalkboard-80 focus:bg-chalkboard-30 dark:focus:bg-chalkboard-80 hover:text-chalkboard-100 dark:hover:text-chalkboard-10 focus:text-chalkboard-100 dark:focus:text-chalkboard-10  focus:outline-none focus-visible:ring-2 focus:ring-primary focus:ring-opacity-50'
  const tooltipPosition: TooltipProps['position'] =
    props.position === 'middle' ? 'top' : `top-${props.position}`

  // If the consumer used `component`, just render that
  if ('component' in props) {
    return props.component({})
  }

  switch (props.element) {
    case 'button':
      return (
        <ActionButton
          Element="button"
          iconStart={
            'icon' in props
              ? props.icon && {
                  icon: props.icon,
                  iconClassName: props.icon === 'loading' ? 'animate-spin' : '',
                  bgClassName: 'bg-transparent dark:bg-transparent',
                }
              : undefined
          }
          className={`${defaultClassNames} ${props.className}`}
          data-testid={props['data-testid']}
        >
          {'label' in props && props.label && !props.hideLabel && (
            <span>{props.label}</span>
          )}
          {(props.toolTip || (props.label && props.hideLabel)) && (
            <Tooltip
              {...(props.toolTip || { children: props.label })}
              position={tooltipPosition}
            />
          )}
        </ActionButton>
      )
    case 'popover':
      return (
        <Popover className="relative">
          <Popover.Button
            as={ActionButton}
            Element="button"
            iconStart={
              'icon' in props
                ? props.icon && {
                    icon: props.icon,
                    iconClassName:
                      props.icon === 'loading' ? 'animate-spin' : '',
                    bgClassName: 'bg-transparent dark:bg-transparent',
                  }
                : undefined
            }
            className={`${defaultClassNames} ${props.className}`}
            data-testid={props['data-testid']}
          >
            {'label' in props && props.label && !props.hideLabel && (
              <span>{props.label}</span>
            )}
            {(props.toolTip || (props.label && props.hideLabel)) && (
              <Tooltip
                {...(props.toolTip || { children: props.label })}
                wrapperClassName={`${
                  props.toolTip?.wrapperClassName || ''
                } ui-open:hidden`}
                position={tooltipPosition}
              />
            )}
          </Popover.Button>
          <Popover.Panel>{props.popoverContent}</Popover.Panel>
        </Popover>
      )
    case 'text':
      return (
        <div
          role="tooltip"
          className={`${defaultClassNames} ${props.className}`}
        >
          {'icon' in props && props.icon && (
            <ActionIcon
              icon={props.icon}
              iconClassName={props.icon === 'loading' ? 'animate-spin' : ''}
              bgClassName="bg-transparent dark:bg-transparent"
            />
          )}
          {'label' in props && props.label && !props.hideLabel && (
            <span>{props.label}</span>
          )}
          {(props.toolTip || (props.label && props.hideLabel)) && (
            <Tooltip
              {...(props.toolTip || { children: props.label })}
              position={tooltipPosition}
            />
          )}
        </div>
      )
    default:
      return (
        <ActionButton
          Element={props.element}
          to={props.href}
          iconStart={
            'icon' in props
              ? props.icon && {
                  icon: props.icon,
                  bgClassName: 'bg-transparent dark:bg-transparent',
                }
              : undefined
          }
          className={`${defaultClassNames} ${props.className}`}
          data-testid={props['data-testid']}
        >
          {'label' in props && props.label && !props.hideLabel && (
            <span>{props.label}</span>
          )}
          {(props.toolTip || (props.label && props.hideLabel)) && (
            <Tooltip
              {...(props.toolTip || { children: props.label })}
              position={tooltipPosition}
            />
          )}
        </ActionButton>
      )
  }
}
