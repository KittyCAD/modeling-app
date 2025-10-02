import type { CustomIconName } from '@src/components/CustomIcon'
import type { areaTypeRegistry } from '@src/lib/layout/areaTypeRegistry'

type BasicArea = {
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

type SplitsArea = BasicArea &
  WithChildren &
  WithSizes &
  WithOrientation & {
    type: 'splits'
  }
type TabsArea = BasicArea &
  WithChildren &
  WithSide & {
    type: 'tabs'
    activeIndex: number
  }
type PanesArea = BasicArea &
  WithSizes &
  WithSide & {
    type: 'panes'
    activeIndices: number[]
    children: (Layout & {
      icon: CustomIconName
    })[]
  }
type SimpleArea = BasicArea & {
  type: 'simple'
  areaType: keyof typeof areaTypeRegistry
}
export type Layout = SimpleArea | SplitsArea | TabsArea | PanesArea
