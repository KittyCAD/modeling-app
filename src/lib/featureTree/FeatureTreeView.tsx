import {
  registerFeatureTree,
  buildFeatureTreeModel,
  type FeatureTreeNode,
  type FeatureTreeSelectionDetail,
  type ZooFeatureTree,
  type ZooFeatureTreeRow,
} from '@kittycad/ui-components/web-components'
import { FEATURE_TREE_EDIT_EVENT } from '@src/lib/featureTree/registry/contract'
import type { ContextMenuProps } from '@src/components/ContextMenu'
import { ContextMenu } from '@src/components/ContextMenu'
import { CustomIcon } from '@src/components/CustomIcon'
import type { ReactNode } from 'react'
import {
  Fragment,
  createContext,
  createElement,
  useContext,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react'

registerFeatureTree()

/** React supplies row data/content; the custom element owns tree interaction. */
type RegisteredRow = {
  node: FeatureTreeNode
  element: ZooFeatureTreeRow
}

type TreeController = {
  register: (row: RegisteredRow, selected: boolean, open: boolean) => void
  unregister: (id: string) => void
  registerDecoration: (
    element: HTMLElement,
    parentId: string | undefined
  ) => void
  unregisterDecoration: (element: HTMLElement) => void
  sync: () => void
  scheduleSync: () => void
}

const TreeContext = createContext<TreeController | null>(null)
const ParentIdContext = createContext<string | undefined>(undefined)

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
  const rows = useRef(new Map<string, RegisteredRow>())
  const decorations = useRef(new Map<HTMLElement, string | undefined>())
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
  const controller = useMemo<TreeController>(() => {
    let scheduled = false
    const sync = () => {
      const tree = ref.current
      if (!tree) return
      // React effects run child-first. DOM order supplies sibling order only;
      // node props and React context supply the complete logical hierarchy.
      const ordered = [...rows.current.values()].sort((a, b) => {
        const position = a.element.compareDocumentPosition(b.element)
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1
        if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1
        return 0
      })
      const nodes = ordered.map(({ node }) => node)
      const expandedIds = [...expanded.current]
      const model = buildFeatureTreeModel(nodes, expandedIds)
      const visible = new Set(model.visible.map(({ id }) => id))
      tree.nodes = nodes
      tree.selectedIds = selectedIds()
      tree.expandedIds = expandedIds
      for (const [element, parentId] of decorations.current) {
        element.hidden =
          parentId !== undefined &&
          (!visible.has(parentId) || !expanded.current.has(parentId))
      }
    }
    const scheduleSync = () => {
      if (scheduled) return
      scheduled = true
      // Publish after the entire React commit registers parents and children.
      queueMicrotask(() => {
        scheduled = false
        sync()
      })
    }
    return {
      sync,
      scheduleSync,
      register(row, isSelected, open) {
        const id = row.node.id
        rows.current.set(id, row)
        const changed =
          !initialized.current.has(id) || initialized.current.get(id) !== open
        initialized.current.set(id, open)
        selected.current.set(id, isSelected)
        if (changed) {
          if (open) expanded.current.add(id)
          else expanded.current.delete(id)
        }
        scheduleSync()
      },
      unregister(id) {
        rows.current.delete(id)
        selected.current.delete(id)
        initialized.current.delete(id)
        expanded.current.delete(id)
        scheduleSync()
      },
      registerDecoration(element, parentId) {
        decorations.current.set(element, parentId)
        scheduleSync()
      },
      unregisterDecoration(element) {
        decorations.current.delete(element)
        scheduleSync()
      },
    }
  }, [selectedIds])
  // Memoized rows may move without rerendering. Publish after each root commit;
  // the observer below also handles reorders inside opaque child components.
  useLayoutEffect(() => controller.scheduleSync())
  useLayoutEffect(() => {
    const tree = ref.current!
    tree.shortcuts = false
    controller.sync()
    const expand = (event: Event) => {
      const { nodeId, expanded: open } = (
        event as CustomEvent<{ nodeId: string; expanded: boolean }>
      ).detail
      if (open) expanded.current.add(nodeId)
      else expanded.current.delete(nodeId)
      controller.sync()
    }
    tree.addEventListener('zoo-expand', expand)
    const select = () => {
      tree.selectedIds = selectedIds()
    }
    tree.addEventListener('zoo-select', select)
    // Keyed React reorders need not rerender individual rows.
    const observer = new MutationObserver(controller.scheduleSync)
    observer.observe(tree, { childList: true })
    onMount?.(tree)
    return () => {
      observer.disconnect()
      tree.removeEventListener('zoo-expand', expand)
      tree.removeEventListener('zoo-select', select)
      onMount?.(null)
    }
  }, [controller, onMount, selectedIds])
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
  const parentId = useContext(ParentIdContext)
  const tree = useContext(TreeContext)
  useLayoutEffect(() => {
    tree?.register(
      {
        node: { id: nodeId, parentId, label, disabled },
        element: ref.current!,
      },
      selected,
      defaultOpen
    )
  })
  useLayoutEffect(() => () => tree?.unregister(nodeId), [tree, nodeId])
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
  return (
    <Fragment>
      {rowElement}
      <ParentIdContext.Provider value={nodeId}>
        {children}
      </ParentIdContext.Provider>
    </Fragment>
  )
}

/** Decorative content shares branch visibility, without becoming keyboard rows. */
function useTreeDecoration<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const tree = useContext(TreeContext)
  const parentId = useContext(ParentIdContext)
  useLayoutEffect(() => {
    if (ref.current) tree?.registerDecoration(ref.current, parentId)
  })
  useLayoutEffect(() => {
    const element = ref.current
    return () => {
      if (element) tree?.unregisterDecoration(element)
    }
  }, [tree])
  return ref
}

export function FeatureTreeDivider() {
  const ref = useTreeDecoration<HTMLHRElement>()
  return <hr ref={ref} className="feature-tree-divider" />
}

export function FeatureTreeNotice({ children }: { children: ReactNode }) {
  const ref = useTreeDecoration<HTMLDivElement>()
  return (
    <div ref={ref} className="feature-tree-notice">
      {children}
    </div>
  )
}
