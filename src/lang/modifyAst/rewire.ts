import type { Node } from '@rust/kcl-lib/bindings/Node'
import { traverse } from '@src/lang/queryAst'
import type { Name, Program, VariableDeclaration } from '@src/lang/wasm'

const isVariableDeclaration = (
  statement: Program['body'][number]
): statement is Node<VariableDeclaration> => {
  return statement.type === 'VariableDeclaration'
}

const isLocalFeatureReference = (name: Node<Name>): boolean => {
  return !name.abs_path && name.path.length === 0
}

const getFirstParentReference = (
  declaration: Node<VariableDeclaration>
): string | null => {
  let parent: string | null = null

  traverse(declaration.declaration.init, {
    enter: (node, pathToNode) => {
      if (parent || node.type !== 'Name') {
        return
      }
      // We only treat local variable names as dependency candidates.
      // Example: in `fillet(extrude001, radius = 1)`, `extrude001` is a feature reference,
      // but `fillet` is the operation name and must never be treated as a parent feature.
      if (!isLocalFeatureReference(node)) {
        return
      }
      if (pathToNode[pathToNode.length - 1]?.[0] === 'callee') {
        return
      }
      parent = node.name.name
    },
  })

  return parent
}

const buildDeletedToParentMap = (
  beforeDeleteAst: Node<Program>,
  afterDeleteAst: Node<Program>
): Map<string, string> => {
  const beforeDeclarationsByName = new Map<string, Node<VariableDeclaration>>()
  const afterDeclarationNames = new Set<string>()

  for (const statement of beforeDeleteAst.body) {
    if (isVariableDeclaration(statement)) {
      beforeDeclarationsByName.set(statement.declaration.id.name, statement)
    }
  }

  for (const statement of afterDeleteAst.body) {
    if (isVariableDeclaration(statement)) {
      afterDeclarationNames.add(statement.declaration.id.name)
    }
  }

  const deletedToParentMap = new Map<string, string>()
  for (const [deletedName, declaration] of beforeDeclarationsByName) {
    if (afterDeclarationNames.has(deletedName)) {
      continue
    }
    const parentName = getFirstParentReference(declaration)
    if (!parentName || parentName === deletedName) {
      continue
    }
    deletedToParentMap.set(deletedName, parentName)
  }

  return deletedToParentMap
}

const resolveRewireTarget = (
  name: string,
  deletedToParentMap: Map<string, string>
): string | null => {
  let current = name
  const visited = new Set<string>([name])

  while (deletedToParentMap.has(current)) {
    const next = deletedToParentMap.get(current)
    if (!next || visited.has(next)) {
      return null
    }
    current = next
    visited.add(current)
  }

  return current === name ? null : current
}

export function rewireAfterDelete(
  beforeDeleteAst: Node<Program>,
  afterDeleteAst: Node<Program>
): Node<Program> {
  const deletedToParentMap = buildDeletedToParentMap(
    beforeDeleteAst,
    afterDeleteAst
  )
  if (deletedToParentMap.size === 0) {
    return afterDeleteAst
  }

  const rewiredAst = structuredClone(afterDeleteAst)
  let didRewire = false

  // First pass is intentionally generic: if a deleted feature had a parent
  // reference, every downstream local reference gets rebound through that parent chain.
  traverse(rewiredAst, {
    enter: (node, pathToNode) => {
      if (node.type !== 'Name') {
        return
      }
      // Rewire only value references to deleted features, never function targets.
      // Example: `hole::hole(hole001, ...)` may rebind `hole001`, but `hole::hole`
      // itself must stay unchanged. Rewriting callees would corrupt operation names.
      if (!isLocalFeatureReference(node)) {
        return
      }
      if (pathToNode[pathToNode.length - 1]?.[0] === 'callee') {
        return
      }

      const replacement = resolveRewireTarget(
        node.name.name,
        deletedToParentMap
      )
      if (!replacement || replacement === node.name.name) {
        return
      }

      node.name.name = replacement
      didRewire = true
    },
  })

  return didRewire ? rewiredAst : afterDeleteAst
}
