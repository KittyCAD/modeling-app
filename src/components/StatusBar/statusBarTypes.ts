import type { CustomIconName } from '@src/components/CustomIcon'
import type { TooltipProps } from '@src/components/Tooltip'
import type { Location } from 'react-router-dom'

export type StatusBarItemType = {
  id: string
  'data-testid'?: string
  order?: number
  scopes?: readonly string[]
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
          href: string | ((location: Location) => string)
          /**
           * Runs in addition to following `href`.
           *
           * For items whose destination is now application state: the anchor
           * stays an anchor — tests and users both reach it as a link — and this
           * is how the app is told, so the derived URL agrees with the one the
           * href names instead of overwriting it.
           */
          onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void
        }
      | {
          element: 'text'
        }
    ))
  | {
      component: React.FC
    }
)
