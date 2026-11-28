import { lazy } from 'react'
import type { ModelingStatusItem } from '@src/lib/kcl/registry/contract'
const item = (
  name:
    | 'ScreenshotItem'
    | 'ExecutionItem'
    | 'MeasurementItem'
    | 'PhysicalAnalysisItem'
    | 'SelectionItem'
    | 'FilterItem'
    | 'UnitsItem'
) =>
  lazy(async () => ({
    default: (await import('@src/lib/kcl/modeling/statusItemViews'))[name],
  }))
export const defaultModelingStatusItems: readonly ModelingStatusItem[] = [
  {
    id: 'screenshot',
    side: 'start',
    order: 0,
    Component: item('ScreenshotItem'),
  },
  { id: 'execution', side: 'end', order: 0, Component: item('ExecutionItem') },
  {
    id: 'measurement',
    side: 'end',
    order: 10,
    Component: item('MeasurementItem'),
  },
  {
    id: 'physical-analysis',
    side: 'end',
    order: 20,
    Component: item('PhysicalAnalysisItem'),
  },
  { id: 'selection', side: 'end', order: 30, Component: item('SelectionItem') },
  {
    id: 'selection-filter',
    side: 'end',
    order: 40,
    Component: item('FilterItem'),
  },
  { id: 'file-units', side: 'end', order: 50, Component: item('UnitsItem') },
]
