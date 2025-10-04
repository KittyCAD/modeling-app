import type { CustomIconName } from '@src/components/CustomIcon'
import type { areaTypeRegistry } from '@src/lib/layout/areaTypeRegistry'
import type { actionTypeRegistry } from '@src/lib/layout/actionTypeRegistry'

type BasicLayout = {
  id: string // uuid
  label: string
}
type WithChildren = { children: Layout[] }
export type Direction = 'horizontal' | 'vertical'
export type Orientation = 'inline' | 'block'
export type StartEnd = 'start' | 'end'
export type Side = `${Orientation}-${StartEnd}`
type WithOrientation = { orientation: Orientation }
type WithSide = {
  side: Side
}
type WithSizes = { sizes: number[] }
type WithIcon = {
  icon: CustomIconName
}

export type SplitLayout = BasicLayout &
  WithChildren &
  WithSizes &
  WithOrientation & {
    type: 'splits'
  }
export type TabLayout = BasicLayout &
  WithChildren &
  WithSide & {
    type: 'tabs'
    activeIndex: number
  }
export type Action = BasicLayout &
  WithIcon & {
    actionType: keyof typeof actionTypeRegistry
  }
export type PaneLayout = BasicLayout &
  WithSizes &
  WithSide & {
    type: 'panes'
    activeIndices: number[]
    children: (Layout & WithIcon)[]
    actions?: Action[]
    /** if the pane layout is a split layout's child in the same axis, it will onExpandSize
     * when it goes from 0 to 1 active child panes
     */
    onExpandSize?: number
  }
export interface Closeable {
  onClose: () => void
}
type SimpleLayout = BasicLayout & {
  type: 'simple'
  areaType: keyof typeof areaTypeRegistry
}
export type Layout = SimpleLayout | SplitLayout | TabLayout | PaneLayout
