import type { MouseEventHandler } from 'react'

export interface BadgeInfoComputed {
  value: number | boolean | string
  onClick?: MouseEventHandler<any>
  className?: string
  title?: string
}

export enum Alignment {
  Left = 'left',
  Right = 'right',
}
