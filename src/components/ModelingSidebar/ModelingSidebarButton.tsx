import { IconDefinition } from '@fortawesome/free-solid-svg-icons'
import { SIDEBAR_BUTTON_SUFFIX } from '@src/lib/constants'
import { useHotkeys } from 'react-hotkeys-hook'
import { ActionIcon } from '../ActionIcon'
import { CustomIconName } from '../CustomIcon'
import Tooltip from '../Tooltip'
import { MouseEventHandler } from 'react'

export interface BadgeInfoComputed {
  value: number | boolean | string
  onClick?: MouseEventHandler<any>
  className?: string
  title?: string
}

interface ModelingPaneButtonProps
  extends React.HTMLAttributes<HTMLButtonElement> {
  paneConfig: {
    id: string
    sidebarName: string
    icon: CustomIconName | IconDefinition
    keybinding: string
    iconClassName?: string
    iconSize?: 'sm' | 'md' | 'lg'
  }
  onClick: () => void
  paneIsOpen?: boolean
  showBadge?: BadgeInfoComputed
  disabledText?: string
  tooltipPosition?: 'right' | 'left'
}

export function ModelingPaneButton({
  paneConfig,
  onClick,
  paneIsOpen,
  showBadge,
  disabledText,
  tooltipPosition = 'right',
  ...props
}: ModelingPaneButtonProps) {
  useHotkeys(paneConfig.keybinding, onClick, {
    scopes: ['modeling'],
  })

  return (
    <div id={paneConfig.id + '-button-holder'} className="relative">
      <button
        className="group pointer-events-auto flex items-center justify-center border-transparent dark:border-transparent disabled:!border-transparent p-0 m-0 rounded-sm !outline-0 focus-visible:border-primary"
        onClick={onClick}
        name={paneConfig.sidebarName}
        data-testid={paneConfig.id + SIDEBAR_BUTTON_SUFFIX}
        disabled={disabledText !== undefined}
        aria-disabled={disabledText !== undefined}
        {...props}
      >
        <ActionIcon
          icon={paneConfig.icon}
          className={paneConfig.iconClassName || ''}
          size={paneConfig.iconSize || 'md'}
          iconClassName={paneIsOpen ? ' !text-chalkboard-10' : ''}
          bgClassName={
            'rounded-sm ' + (paneIsOpen ? '!bg-primary' : '!bg-transparent')
          }
        />
        <span className="sr-only">
          {paneConfig.sidebarName}
          {paneIsOpen !== undefined ? ` pane` : ''}
        </span>
        <Tooltip
          position={tooltipPosition}
          contentClassName="max-w-none flex items-center gap-4"
          hoverOnly
        >
          <span className="flex-1">
            {paneConfig.sidebarName}
            {disabledText !== undefined ? ` (${disabledText})` : ''}
            {paneIsOpen !== undefined ? ` pane` : ''}
          </span>
          <kbd className="hotkey text-xs capitalize">
            {paneConfig.keybinding}
          </kbd>
        </Tooltip>
      </button>
      {!!showBadge?.value && (
        <p
          id={`${paneConfig.id}-badge`}
          className={
            showBadge.className
              ? showBadge.className
              : 'absolute m-0 p-0 bottom-4 left-4 w-3 h-3 flex items-center justify-center text-[10px] font-semibold text-white bg-primary hue-rotate-90 rounded-full border border-chalkboard-10 dark:border-chalkboard-80 z-50 hover:cursor-pointer hover:scale-[2] transition-transform duration-200'
          }
          onClick={showBadge.onClick}
          title={
            showBadge.title
              ? showBadge.title
              : `Click to view ${showBadge.value} notification${
                  Number(showBadge.value) > 1 ? 's' : ''
                }`
          }
        >
          <span className="sr-only">&nbsp;has&nbsp;</span>
          {typeof showBadge.value === 'number' ||
          typeof showBadge.value === 'string' ? (
            <span>{showBadge.value}</span>
          ) : (
            <span className="sr-only">a</span>
          )}
          {typeof showBadge.value === 'number' && (
            <span className="sr-only">
              &nbsp;notification{Number(showBadge.value) > 1 ? 's' : ''}
            </span>
          )}
        </p>
      )}
    </div>
  )
}
