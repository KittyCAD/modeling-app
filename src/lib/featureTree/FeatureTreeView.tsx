import {
  registerFeatureTree,
  type ZooFeatureTree,
  type ZooFeatureTreeRow,
} from '@kittycad/ui-components/web-components'
import type { ContextMenuProps } from '@src/components/ContextMenu'
import { ContextMenu } from '@src/components/ContextMenu'
import { CustomIcon } from '@src/components/CustomIcon'
import type { ReactNode } from 'react'
import {
  createContext,
  createElement,
  useContext,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react'

registerFeatureTree()

/** React supplies operation content/actions; the custom element owns tree interaction. */
const TreeContext = createContext<{
  register: (id: string, selected: boolean, open: boolean) => void
  unregister: (id: string) => void
} | null>(null)
const DepthContext = createContext(false)

export function FeatureTree({
  children,
  onMount,
  label = 'Feature tree',
  appearance = 'hud',
}: {
  children: ReactNode
  onMount?: (element: ZooFeatureTree | null) => void
  label?: string
  appearance?: ZooFeatureTree['appearance']
}) {
  const ref = useRef<ZooFeatureTree>(null)
  const selected = useRef(new Map<string, boolean>())
  const initialized = useRef(new Map<string, boolean>())
  const expanded = useRef(new Set<string>())
  const preferredSelection = useRef<string | undefined>(undefined)
  const selectedIds = useCallback(() => {
    const ids = [...selected.current]
      .filter(([, value]) => value)
      .map(([id]) => id)
    const focused = ref.current?.focusedNodeId
    if (focused && ids.includes(focused)) preferredSelection.current = focused
    return preferredSelection.current &&
      ids.includes(preferredSelection.current)
      ? [preferredSelection.current]
      : ids.slice(0, 1)
  }, [])
  const controller = useMemo(
    () => ({
      register(id: string, isSelected: boolean, open: boolean) {
        const changed =
          !initialized.current.has(id) || initialized.current.get(id) !== open
        initialized.current.set(id, open)
        selected.current.set(id, isSelected)
        if (changed) {
          if (open) expanded.current.add(id)
          else expanded.current.delete(id)
        }
        if (ref.current) {
          ref.current.selectedIds = selectedIds()
          ref.current.expandedIds = [...expanded.current]
        }
      },
      unregister(id: string) {
        selected.current.delete(id)
        initialized.current.delete(id)
        expanded.current.delete(id)
        if (ref.current) {
          ref.current.selectedIds = selectedIds()
          ref.current.expandedIds = [...expanded.current]
        }
      },
    }),
    [selectedIds]
  )
  useLayoutEffect(() => {
    const tree = ref.current!
    tree.shortcuts = false
    tree.selectedIds = selectedIds()
    tree.expandedIds = [...expanded.current]
    const expand = (event: Event) => {
      const { nodeId, expanded: open } = (
        event as CustomEvent<{ nodeId: string; expanded: boolean }>
      ).detail
      if (open) expanded.current.add(nodeId)
      else expanded.current.delete(nodeId)
      tree.expandedIds = [...expanded.current]
    }
    tree.addEventListener('zoo-expand', expand)
    const select = () => {
      tree.selectedIds = selectedIds()
    }
    tree.addEventListener('zoo-select', select)
    onMount?.(tree)
    return () => {
      tree.removeEventListener('zoo-expand', expand)
      tree.removeEventListener('zoo-select', select)
      onMount?.(null)
    }
  }, [onMount, selectedIds])
  return (
    <TreeContext.Provider value={controller}>
      {createElement(
        'zoo-feature-tree',
        {
          ref,
          appearance,
          'aria-label': label,
          'data-testid': 'debug-panel',
          style: { height: 'auto', overflow: 'visible' },
        },
        children
      )}
    </TreeContext.Provider>
  )
}

export function FeatureTreeRow({
  nodeId,
  label,
  detail,
  selected = false,
  disabled = false,
  children,
  defaultOpen = false,
  onSelect,
  onDoubleClick,
  onContextMenu,
  visibility,
  menuItems,
  status,
  moduleId,
  tooltip,
  icon,
  actions,
}: {
  nodeId: string
  label: string
  detail?: ReactNode
  selected?: boolean
  disabled?: boolean
  children?: ReactNode
  defaultOpen?: boolean
  onSelect?: (event: Event) => void
  onDoubleClick?: (event: Event) => void
  onContextMenu?: (event: MouseEvent) => void
  visibility?: { visible: boolean; onVisibilityChange: () => unknown }
  menuItems?: ContextMenuProps['items']
  status?: ReactNode
  moduleId?: number
  tooltip?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
}) {
  const ref = useRef<ZooFeatureTreeRow>(null)
  const menuRef = useRef<HTMLSpanElement>(null)
  const nested = useContext(DepthContext)
  const tree = useContext(TreeContext)
  useLayoutEffect(() => {
    tree?.register(nodeId, selected, defaultOpen)
  }, [tree, nodeId, selected, defaultOpen])
  useLayoutEffect(() => () => tree?.unregister(nodeId), [tree, nodeId])
  useLayoutEffect(() => {
    const row = ref.current!
    const select = (event: Event) => {
      if (event.target === row && !disabled) onSelect?.(event)
    }
    const menu = (event: Event) => {
      if (event.target !== row || disabled) return
      const { clientX, clientY } = (
        event as CustomEvent<{ clientX: number; clientY: number }>
      ).detail
      menuRef.current?.dispatchEvent(
        new MouseEvent('contextmenu', { clientX, clientY, cancelable: true })
      )
    }
    const doubleClick = (event: Event) => {
      const path = event.composedPath()
      if (
        !disabled &&
        path.find(
          (element) =>
            element instanceof HTMLElement &&
            element.tagName === 'ZOO-FEATURE-TREE-ROW'
        ) === row &&
        !path.some((element) => element instanceof HTMLButtonElement)
      )
        onDoubleClick?.(event)
    }
    row.addEventListener('zoo-select', select)
    row.addEventListener('zoo-context-menu', menu)
    row.addEventListener('dblclick', doubleClick)
    return () => {
      row.removeEventListener('zoo-select', select)
      row.removeEventListener('zoo-context-menu', menu)
      row.removeEventListener('dblclick', doubleClick)
    }
  }, [disabled, onSelect, onDoubleClick])
  return createElement(
    'zoo-feature-tree-row',
    {
      ref,
      'node-id': nodeId,
      label,
      disabled: disabled || undefined,
      slot: nested ? 'children' : undefined,
      'data-testid': 'feature-tree-operation-item',
      'data-module-branch': moduleId,
    },
    icon && <span slot="icon">{icon}</span>,
    <span slot="label">
      {label}
      {tooltip}
    </span>,
    detail && <span slot="detail">{detail}</span>,
    status && <span slot="status">{status}</span>,
    <span slot="actions" ref={menuRef}>
      {actions}
      {visibility && (
        <button
          type="button"
          aria-label={`${visibility.visible ? 'Hide' : 'Show'} ${label}`}
          aria-pressed={!visibility.visible}
          data-testid="feature-tree-visibility-toggle"
          onClick={() => {
            visibility.onVisibilityChange()
          }}
        >
          <CustomIcon
            name={visibility.visible ? 'eyeOpen' : 'eyeCrossedOut'}
            className="w-5 h-5"
          />
        </button>
      )}
      {menuItems && (
        <>
          <ContextMenu
            items={menuItems}
            menuTargetElement={menuRef}
            callback={onContextMenu}
          />
        </>
      )}
    </span>,
    <DepthContext.Provider value={true}>{children}</DepthContext.Provider>
  )
}

/** Native separators are decorative: they never enter the tree's keyboard row model. */
export function FeatureTreeDivider() {
  const nested = useContext(DepthContext)
  return (
    <hr
      slot={nested ? 'children' : undefined}
      className="feature-tree-divider"
    />
  )
}

export function FeatureTreeNotice({ children }: { children: ReactNode }) {
  const nested = useContext(DepthContext)
  return (
    <div slot={nested ? 'children' : undefined} className="feature-tree-notice">
      {children}
    </div>
  )
}
