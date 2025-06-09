import type { CustomIconName } from '@src/components/CustomIcon'
import type { TooltipProps } from '@src/components/Tooltip'

export type StatusBarItemType = {
  id: string
  label: string
  icon?: CustomIconName
  hideLabel?: boolean
  toolTip?: Omit<TooltipProps, 'position'>
  className?: string
  ['data-testid']?: string
} & (
  | {
      element: 'button'
      onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
    }
  | {
      element: 'popover'
      popoverContent: React.ReactNode
    }
  | {
      element: 'link' | 'externalLink'
      href: string
    }
  | {
      element: 'text'
    }
)
