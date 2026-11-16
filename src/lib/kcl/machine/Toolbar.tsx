import { ResponsiveToolbar } from '@src/components/Toolbar/ResponsiveToolbar'
import type { ToolbarGroup, ToolbarNode } from '@src/components/Toolbar/groups'
import type { ToolbarView } from '@src/components/Toolbar/ToolbarView'
import type { ComponentProps } from 'react'

/** The legacy resolver supplies eligibility and actions; its section breaks/dropdowns become groups for the existing responsive view. */
export function MachineResponsiveToolbar({
  items,
  ...props
}: ComponentProps<typeof ToolbarView>) {
  const groups: ToolbarGroup[] = []
  let children: ToolbarNode[] = []
  const finish = () => {
    if (!children.length) return
    groups.push({
      id: `machine-toolbar.${props.mode}.${groups.length}`,
      title: children[0].title,
      children,
    })
    children = []
  }
  for (const entry of items) {
    if (entry === 'break') {
      finish()
      continue
    }
    if ('array' in entry) {
      children.push({
        id: entry.id,
        title: entry.title ?? entry.array[0]?.title ?? 'Tools',
        defaultToolId: entry.selectedId ?? entry.defaultVisibleItemIds?.[0],
        children: entry.array,
      })
    } else children.push(entry)
  }
  finish()
  return <ResponsiveToolbar {...props} items={groups} />
}
