import {
  registerFeatureTree,
  buildFeatureTreeModel,
  type FeatureTreeNode,
  type FeatureTreeSelectionDetail,
  type ZooFeatureTree,
  type ZooFeatureTreeRow,
} from '@kittycad/ui-components/web-components'
import { FEATURE_TREE_EDIT_EVENT } from '@src/lib/featureTree/registry/commands'
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
  useState,
  useRef,
} from 'react'

registerFeatureTree()

/** The caller supplies complete node data; React only renders content and routes events. */
const TreeContext = createContext<ReadonlySet<string>>(new Set())

export function FeatureTree({
  children,
  nodes,
  selectedIds = [],
  defaultExpandedIds = [],
  onMount,
  label = 'Feature tree',
  appearance = 'hud',
}: {
  children: ReactNode
  nodes: readonly FeatureTreeNode[]
  selectedIds?: readonly string[]
  defaultExpandedIds?: readonly string[]
  onMount?: (element: ZooFeatureTree | null) => void
  label?: string
  appearance?: ZooFeatureTree['appearance']
}) {
  const ref = useRef<ZooFeatureTree>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(defaultExpandedIds)
  )
  const previousDefaults = useRef(new Map<string, boolean>())
  const preferredSelection = useRef<string | undefined>(undefined)
  const candidates = useRef(selectedIds)
  candidates.current = selectedIds
  const controlledSelection = useCallback(() => {
    const ids = candidates.current
    const focused = ref.current?.focusedNodeId
    if (focused && ids.includes(focused)) preferredSelection.current = focused
    const preferred = preferredSelection.current
    return preferred && ids.includes(preferred) ? [preferred] : ids.slice(0, 1)
  }, [])
  useLayoutEffect(() => {
    const defaults = new Set(defaultExpandedIds)
    const previous = previousDefaults.current
    setExpanded((current) => {
      const next = new Set<string>()
      for (const node of nodes) {
        const open = defaults.has(node.id)
        const changed = !previous.has(node.id) || previous.get(node.id) !== open
        if (changed ? open : current.has(node.id)) next.add(node.id)
      }
      return next.size === current.size &&
        [...next].every((id) => current.has(id))
        ? current
        : next
    })
    previousDefaults.current = new Map(
      nodes.map(({ id }) => [id, defaults.has(id)])
    )
  }, [nodes, defaultExpandedIds])
  const expandedIds = useMemo(() => [...expanded], [expanded])
  const visibleBranches = useMemo(
    () =>
      new Set(
        buildFeatureTreeModel(nodes, expandedIds)
          .visible.filter(({ id }) => expanded.has(id))
          .map(({ id }) => id)
      ),
    [nodes, expandedIds, expanded]
  )
  useLayoutEffect(() => {
    const tree = ref.current!
    tree.shortcuts = false
    tree.nodes = nodes
    tree.expandedIds = expandedIds
    tree.selectedIds = controlledSelection()
  }, [nodes, expandedIds, selectedIds, controlledSelection])
  useLayoutEffect(() => {
    const tree = ref.current!
    const expand = (event: Event) => {
      const { nodeId, expanded: open } = (
        event as CustomEvent<{ nodeId: string; expanded: boolean }>
      ).detail
      setExpanded((current) => {
        const next = new Set(current)
        if (open) next.add(nodeId)
        else next.delete(nodeId)
        return next
      })
    }
    const select = () => {
      tree.selectedIds = controlledSelection()
    }
    tree.addEventListener('zoo-expand', expand)
    tree.addEventListener('zoo-select', select)
    tree.addEventListener('zoo-selection-change', select)
    onMount?.(tree)
    return () => {
      tree.removeEventListener('zoo-expand', expand)
      tree.removeEventListener('zoo-select', select)
      tree.removeEventListener('zoo-selection-change', select)
      onMount?.(null)
    }
  }, [onMount, controlledSelection])
  return (
    <TreeContext.Provider value={visibleBranches}>
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
  disabled = false,
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
  disabled?: boolean
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
  useLayoutEffect(() => {
    const row = ref.current!
    const owner = row.closest<ZooFeatureTree>('zoo-feature-tree')
    // Mouse and keyboard selection converge on the tree's controlled selection event.
    const select = (event: Event) => {
      const { nodeId: selectedNodeId } = (
        event as CustomEvent<FeatureTreeSelectionDetail>
      ).detail
      if (selectedNodeId === nodeId && !disabled) onSelect?.(event)
    }
    const edit = (event: Event) => {
      const { nodeId: editedNodeId } = (
        event as CustomEvent<{ nodeId: string }>
      ).detail
      if (editedNodeId !== nodeId || disabled) return
      // Capture both callbacks before selection can synchronously rerender the row.
      onSelect?.(event)
      onDoubleClick?.(event)
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
    owner?.addEventListener('zoo-selection-change', select)
    owner?.addEventListener(FEATURE_TREE_EDIT_EVENT, edit)
    row.addEventListener('zoo-context-menu', menu)
    row.addEventListener('dblclick', doubleClick)
    return () => {
      owner?.removeEventListener('zoo-selection-change', select)
      owner?.removeEventListener(FEATURE_TREE_EDIT_EVENT, edit)
      row.removeEventListener('zoo-context-menu', menu)
      row.removeEventListener('dblclick', doubleClick)
    }
  }, [disabled, nodeId, onSelect, onDoubleClick])
  const rowElement = createElement(
    'zoo-feature-tree-row',
    {
      ref,
      'node-id': nodeId,
      label,
      disabled: disabled || undefined,
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
    </span>
  )
  return rowElement
}

/** Decorations receive explicit branch identity, without registering keyboard rows. */
export function FeatureTreeDivider({ parentId }: { parentId?: string }) {
  const visible = useContext(TreeContext)
  return (
    <hr
      hidden={parentId !== undefined && !visible.has(parentId)}
      className="feature-tree-divider"
    />
  )
}
export function FeatureTreeNotice({
  children,
  parentId,
}: {
  children: ReactNode
  parentId?: string
}) {
  const visible = useContext(TreeContext)
  return (
    <div
      hidden={parentId !== undefined && !visible.has(parentId)}
      className="feature-tree-notice"
    >
      {children}
    </div>
  )
}
