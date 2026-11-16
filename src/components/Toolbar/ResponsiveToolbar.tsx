import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from 'react'
import {
  ToolbarView,
  type ToolbarViewEntry,
  type ToolbarViewItem,
} from '@src/components/Toolbar/ToolbarView'
import type { ToolbarMenuItem } from '@src/components/ActionButtonDropdown'
import {
  fitToolbar,
  isToolbarGroup,
  projectToolbar,
  representative,
  toolbarGroups,
  toolbarLeaves,
  type ToolbarGroup,
  type ToolbarNode,
} from '@src/components/Toolbar/groups'

type Props = Omit<
  ComponentProps<typeof ToolbarView>,
  'items' | 'nowrap' | 'onMenuOpenChange'
> & { items: readonly ToolbarNode[] }

/** Own layout and group recency per editor view; the existing toolbar owns button and help presentation. */
export function ResponsiveToolbar({ items, ...props }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const probes = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<string | undefined>(undefined)
  const [recent, setRecent] = useState<ReadonlyMap<string, string>>(new Map())
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [open, setOpen] = useState(false)
  const menuOpenChange = useCallback((value: boolean) => setOpen(value), [])
  const adapted = useMemo(() => {
    const visit = (
      nodes: readonly ToolbarNode[],
      ancestors: string[]
    ): ToolbarNode[] =>
      nodes.map((node) =>
        isToolbarGroup(node)
          ? { ...node, children: visit(node.children, [...ancestors, node.id]) }
          : {
              ...node,
              onClick: (event) => {
                setRecent((previous) => {
                  const next = new Map(previous)
                  for (const id of ancestors) next.set(id, node.id)
                  return next
                })
                node.onClick(event)
              },
            }
      )
    return visit(items, [])
  }, [items])
  const menu = (nodes: readonly ToolbarNode[]): ToolbarMenuItem[] =>
    nodes.flatMap<ToolbarMenuItem>((node) =>
      isToolbarGroup(node)
        ? toolbarLeaves(node.children).length
          ? [{ id: node.id, label: node.title, children: menu(node.children) }]
          : []
        : [
            {
              id: node.id,
              label: node.title,
              icon: node.icon,
              iconColor: node.iconColor,
              hotkey: node.hotkey,
              status: node.status,
              disabled:
                props.disableAllButtons ||
                node.disabled ||
                !['available', 'experimental'].includes(node.status),
              onClick: node.onClick,
            },
          ]
    )
  const dropdown = (
    group: ToolbarGroup,
    selected: ToolbarViewItem
  ): ToolbarViewEntry => ({
    id: group.id,
    title: group.title,
    array: toolbarLeaves(group.children).map((item) => ({
      ...item,
      showTitle: false,
    })),
    selectedId: selected.id,
    menuItems: menu(group.children),
  })
  const visible = projectToolbar(adapted, collapsed, recent).map((entry) =>
    entry === 'break'
      ? entry
      : 'group' in entry
        ? dropdown(entry.group, entry.selected)
        : entry
  )
  const measurements: { key: string; entry: ToolbarViewEntry }[] = [
    ...toolbarLeaves(items).map((item) => ({
      key: `tool:${item.id}`,
      entry: item,
    })),
    ...toolbarGroups(items).flatMap((group) => {
      const selected = representative(group, recent)
      return selected
        ? [{ key: `group:${group.id}`, entry: dropdown(group, selected) }]
        : []
    }),
  ]
  useLayoutEffect(() => {
    const measure = () => {
      const element = container.current
      if (!element || open || element.querySelector('[aria-expanded="true"]'))
        return
      const width = element.getBoundingClientRect().width
      const widths = new Map<string, number>()
      for (const probe of probes.current?.querySelectorAll<HTMLElement>(
        '[data-toolbar-measure]'
      ) ?? []) {
        const control = probe.querySelector('ul')?.firstElementChild
        const size = control?.getBoundingClientRect().width ?? 0
        if (!size) return
        widths.set(probe.dataset.toolbarMeasure!, size)
      }
      if (!width || !widths.size) return
      const bar = element.querySelector<HTMLElement>('[role="toolbar"]')
      const list = bar?.querySelector('ul')
      const style = bar && getComputedStyle(bar)
      const chrome = style
        ? [
            style.paddingLeft,
            style.paddingRight,
            style.borderLeftWidth,
            style.borderRightWidth,
          ].reduce((sum, value) => sum + (Number.parseFloat(value) || 0), 0)
        : 18
      const gap = list
        ? Number.parseFloat(getComputedStyle(list).columnGap) || 6
        : 6
      const next = fitToolbar(items, width, widths, recent, gap, chrome)
      if (
        collapsed.size === next.size &&
        [...collapsed].every((id) => next.has(id))
      )
        return
      const focused = document.activeElement
      if (focused instanceof HTMLElement && element.contains(focused)) {
        pendingFocus.current =
          focused.dataset.toolbarToolId ??
          focused.parentElement?.querySelector<HTMLElement>(
            '[data-toolbar-tool-id]'
          )?.dataset.toolbarToolId
      }
      setCollapsed(next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (container.current) observer.observe(container.current)
    for (const probe of probes.current?.children ?? []) observer.observe(probe)
    return () => observer.disconnect()
  }, [items, recent, open, collapsed])
  useLayoutEffect(() => {
    const id = pendingFocus.current
    pendingFocus.current = undefined
    if (!id || document.activeElement !== document.body) return
    const projected = projectToolbar(items, collapsed, recent)
    const entry = projected.find(
      (entry) =>
        entry !== 'break' &&
        ('group' in entry
          ? toolbarLeaves(entry.group.children).some((item) => item.id === id)
          : entry.id === id)
    )
    const target =
      entry && entry !== 'break'
        ? 'group' in entry
          ? entry.selected.id
          : entry.id
        : undefined
    const button = Array.from(
      container.current?.querySelectorAll<HTMLButtonElement>(
        'button[data-toolbar-tool-id]'
      ) ?? []
    ).find((button) => button.dataset.toolbarToolId === target)
    button?.focus()
  }, [collapsed, items, recent])
  // Probe the same controls, including their real icon/title styling. Inert copies cannot receive input.
  const inertItem = (item: ToolbarViewItem): ToolbarViewItem => ({
    ...item,
    id: `measure:${item.id}`,
    onClick: () => {},
  })
  const inertEntry = (entry: ToolbarViewEntry): ToolbarViewEntry =>
    entry === 'break'
      ? entry
      : 'array' in entry
        ? {
            ...entry,
            id: `measure:${entry.id}`,
            array: entry.array.map(inertItem),
            selectedId: entry.selectedId
              ? `measure:${entry.selectedId}`
              : undefined,
            menuItems: [],
          }
        : inertItem(entry)
  return (
    <div
      ref={container}
      className="w-full min-w-0 flex justify-center relative"
      data-responsive-toolbar
    >
      <ToolbarView
        {...props}
        items={visible}
        nowrap
        onMenuOpenChange={menuOpenChange}
      />
      <div
        ref={probes}
        aria-hidden="true"
        inert
        className="invisible pointer-events-none fixed left-0 top-0 flex w-max"
        style={{ contain: 'layout' }}
      >
        {measurements.map(({ key, entry }) => (
          <div key={key} data-toolbar-measure={key}>
            <ToolbarView
              mode={props.mode}
              platform={props.platform}
              idPrefix={`measure-${key}-`}
              testId="toolbar-measure"
              items={[inertEntry(entry)]}
              nowrap
            />
          </div>
        ))}
      </div>
    </div>
  )
}
