import { Disclosure } from '@headlessui/react'
import type { ReactNode } from 'react'
import { createContext, use, useEffect, useMemo } from 'react'

const ExpansionContext = createContext<Map<string, boolean> | null>(null)

export function FeatureTreeExpansionProvider({
  filePath,
  children,
}: {
  filePath: string
  children: ReactNode
}) {
  // Keep choices while execution temporarily removes rows, scoped to this file.
  const state = useMemo(
    () => ({ filePath, expanded: new Map<string, boolean>() }),
    [filePath]
  )
  return (
    <ExpansionContext.Provider key={state.filePath} value={state.expanded}>
      {children}
    </ExpansionContext.Provider>
  )
}

export function FeatureTreeDisclosure({
  expansionKey,
  defaultOpen = false,
  children,
  ...props
}: {
  expansionKey: string
  defaultOpen?: boolean
  children: ReactNode
  as?: 'div'
  'data-testid'?: string
}) {
  const expanded = use(ExpansionContext)
  return (
    <Disclosure
      as="div"
      defaultOpen={expanded?.get(expansionKey) ?? defaultOpen}
      {...props}
    >
      {({ open }) => (
        <RememberExpansion expansionKey={expansionKey} open={open}>
          {children}
        </RememberExpansion>
      )}
    </Disclosure>
  )
}

function RememberExpansion({
  expansionKey,
  open,
  children,
}: {
  expansionKey: string
  open: boolean
  children: ReactNode
}) {
  const expanded = use(ExpansionContext)
  useEffect(() => {
    expanded?.set(expansionKey, open)
  }, [expanded, expansionKey, open])
  return children
}
