import type { CustomIconName } from '@src/components/CustomIcon'
import type { areaTypeRegistry } from '@src/lib/layout/areaTypeRegistry'

type BasicLayout = {
  id: string
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
export type PaneLayout = BasicLayout &
  WithSizes &
  WithSide & {
    type: 'panes'
    activeIndices: number[]
    children: (Layout & {
      icon: CustomIconName
    })[]
    /** if the pane layout is a split layout's child in the same axis, it will onExpandSize
     * when it goes from 0 to 1 active child panes
     */
    onExpandSize?: number
  }
type SimpleLayout = BasicLayout & {
  type: 'simple'
  areaType: keyof typeof areaTypeRegistry
}
export type Layout = SimpleLayout | SplitLayout | TabLayout | PaneLayout
