import { CustomIcon } from '@src/components/CustomIcon'
import type { OperationTree } from '@src/lib/featureTreeOperationTree'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

interface ModuleExpansion {
  expanded: Set<number>
  toggle: (moduleId: number) => void
  reveal: (moduleId: number) => void
  getChildren: OperationTree['getChildren']
}

const ModuleExpansionContext = createContext<ModuleExpansion | null>(null)

export function useRevealFeatureTreeModule() {
  return useContext(ModuleExpansionContext)?.reveal
}

export function useFeatureTreeModuleChildren() {
  return useContext(ModuleExpansionContext)?.getChildren
}

/** Expansion belongs to the pane so closing an ancestor preserves child choices. */
export function FeatureTreeModules({
  tree,
  executionGeneration,
  children,
}: {
  tree: OperationTree
  executionGeneration: number
  children: ReactNode
}) {
  const container = useRef<HTMLDivElement>(null)
  const [state, setState] = useState({
    executionGeneration,
    expanded: new Set<number>(),
    reveal: null as { moduleId: number } | null,
  })

  // Module IDs belong to an execution. Start each run collapsed, then preserve
  // user choices through its progressive updates and final result.
  if (state.executionGeneration !== executionGeneration) {
    setState({
      executionGeneration,
      expanded: new Set<number>(),
      reveal: null,
    })
  }

  const toggle = useCallback((moduleId: number) => {
    setState((previous) => {
      const expanded = new Set(previous.expanded)
      if (expanded.has(moduleId)) {
        expanded.delete(moduleId)
      } else {
        expanded.add(moduleId)
      }
      return { ...previous, expanded, reveal: null }
    })
  }, [])

  const reveal = useCallback(
    (moduleId: number) => {
      const ancestors = tree.getModuleAncestors(moduleId)
      setState((previous) => ({
        ...previous,
        expanded: new Set([...previous.expanded, ...ancestors]),
        reveal: { moduleId },
      }))
    },
    [tree]
  )

  useLayoutEffect(() => {
    if (!state.reveal) {
      return
    }
    const branch = container.current?.querySelector<HTMLElement>(
      `[data-module-branch="${state.reveal.moduleId}"]`
    )
    if (!branch) {
      return
    }
    branch.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const row = branch.querySelector<HTMLElement>(
      '[data-testid="feature-tree-operation-item"]'
    )
    row?.classList.add('bg-primary/25')
    const timeout = setTimeout(
      () => row?.classList.remove('bg-primary/25'),
      1500
    )
    return () => {
      clearTimeout(timeout)
      row?.classList.remove('bg-primary/25')
    }
  }, [state.reveal])

  const value = useMemo(
    () => ({
      expanded: state.expanded,
      toggle,
      reveal,
      getChildren: tree.getChildren,
    }),
    [state.expanded, toggle, reveal, tree.getChildren]
  )
  return (
    <ModuleExpansionContext.Provider value={value}>
      <div ref={container}>{children}</div>
    </ModuleExpansionContext.Provider>
  )
}

export function FeatureTreeModule({
  moduleId,
  name,
  heading,
  children,
}: {
  moduleId: number
  name: string
  heading: ReactNode
  children: () => ReactNode
}) {
  const modules = useContext(ModuleExpansionContext)
  const panelId = useId()
  if (!modules) {
    return null
  }
  const open = modules.expanded.has(moduleId)

  return (
    <>
      <div className="flex items-start gap-1" data-module-branch={moduleId}>
        <button
          type="button"
          aria-label={`${open ? 'Collapse' : 'Expand'} ${name}`}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          data-testid="operation-group-caret"
          className="reset !px-0 !py-1 self-stretch !border-transparent focus-within:bg-primary/25 hover:!bg-2 hover:focus-within:bg-primary/25"
          onClick={() => modules.toggle(moduleId)}
        >
          <CustomIcon
            name="caretDown"
            className={`w-4 h-4 block ${open ? '' : '-rotate-90'}`}
            aria-hidden
          />
        </button>
        <div className="flex-1 min-w-0">{heading}</div>
      </div>
      {open && (
        <div id={panelId} className="border-l b-4 ml-6">
          {children()}
        </div>
      )}
    </>
  )
}
