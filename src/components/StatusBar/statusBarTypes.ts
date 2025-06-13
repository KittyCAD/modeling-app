import type { CustomIconName } from '@src/components/CustomIcon'
import type { TooltipProps } from '@src/components/Tooltip'

export type StatusBarItemType = {
  id: string
  'data-testid'?: string
} & (
  | ({
      label: string
      hideLabel?: boolean
      className?: string
      toolTip?: Omit<TooltipProps, 'position'>
      icon?: CustomIconName
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
    ))
  | {
      component: React.FC
    }
)
