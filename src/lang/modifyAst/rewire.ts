import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { KCLNode } from '@src/lang/queryAst'
import { traverse } from '@src/lang/queryAst'
import type {
  Name,
  PathToNode,
  Program,
  VariableDeclaration,
} from '@src/lang/wasm'

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

// Scopes whose bindings may shadow a deleted feature's name. traverse fires
// enter/leave for every scope container -- FunctionExpression, Block (sketch
// block bodies and bare blocks), and if-expression arm bodies -- so scope
// tracking is a plain stack: push a frame on the container's enter and pop it
// on the container's leave.
type ScopeFrame = {
  container: KCLNode
  bindings: Set<string>
}

// If-expression arm bodies are Program nodes without a `type` field, so they
// are recognized by their path instead: traverse visits each arm container at
// `['then_val'|'final_else', 'IfExpression']`, and nothing else is visited
// with that final segment.
const isIfArmBodyPath = (pathToNode: PathToNode): boolean => {
  const segment = pathToNode[pathToNode.length - 1]
  return (
    segment !== undefined &&
    (segment[0] === 'then_val' || segment[0] === 'final_else') &&
    segment[1] === 'IfExpression'
  )
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
  afterDeleteAst: Node<Program>,
  options: { useV3ArmScoping: boolean } = { useV3ArmScoping: false }
): Node<Program> {
  const { useV3ArmScoping } = options
  const deletedToParentMap = buildDeletedToParentMap(
    beforeDeleteAst,
    afterDeleteAst
  )
  if (deletedToParentMap.size === 0) {
    return afterDeleteAst
  }

  const rewiredAst = structuredClone(afterDeleteAst)
  let didRewire = false
  const scopeFrames: ScopeFrame[] = []
  // KCL 3.0: declarations whose binding takes effect on leave. See below.
  const pendingBindings: {
    declaration: Node<VariableDeclaration>
    frame: ScopeFrame
  }[] = []

  // First pass is intentionally generic: if a deleted feature had a parent
  // reference, every unshadowed downstream reference gets rebound through that
  // parent chain.
  traverse(rewiredAst, {
    enter: (node, pathToNode) => {
      if (node.type === 'FunctionExpression') {
        const bindings = new Set(
          node.params.map((param) => param.identifier.name)
        )
        if (node.name) {
          bindings.add(node.name.name)
        }
        scopeFrames.push({ container: node, bindings })
        return
      }

      // Sketch-block bodies and bare blocks are their own scope at runtime in
      // every KCL version.
      if (node.type === 'Block') {
        scopeFrames.push({ container: node, bindings: new Set() })
        return
      }

      // KCL 3.0: each if/else-if/else arm body is its own scope. Under older
      // entry points arm bindings share the enclosing scope, so no frame is
      // pushed (and the container's leave pops nothing). Conditions are
      // visited outside the arm containers and resolve in the enclosing
      // scope either way.
      if (useV3ArmScoping && isIfArmBodyPath(pathToNode)) {
        scopeFrames.push({ container: node, bindings: new Set() })
        return
      }

      // Top-level declarations are deliberately left unregistered: they are
      // the rewire targets themselves, not shadows.
      if (node.type === 'VariableDeclaration' && scopeFrames.length > 0) {
        const frame = scopeFrames[scopeFrames.length - 1]
        if (useV3ArmScoping) {
          // KCL 3.0: a binding is in scope only from its declaration onward,
          // so the declaration's own initializer still sees the enclosing
          // scope and must be rewired (`deleted001 = deleted001 + 1` becomes
          // `deleted001 = parent001 + 1`). Register on leave, after the
          // initializer subtree has been visited. This intentionally applies
          // to function bodies too, not just arm bodies, matching runtime
          // evaluation order.
          pendingBindings.push({ declaration: node, frame })
        } else {
          frame.bindings.add(node.declaration.id.name)
        }
        return
      }

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
      if (scopeFrames.some((frame) => frame.bindings.has(node.name.name))) {
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
    leave: (node) => {
      if (node.type === 'VariableDeclaration') {
        // The captured frame is an enclosing scope of the declaration, so it
        // is still live here. Top-level declarations never registered a
        // pending binding, so identity matching skips them.
        const pending = pendingBindings[pendingBindings.length - 1]
        if (pending?.declaration === node) {
          pendingBindings.pop()
          pending.frame.bindings.add(node.declaration.id.name)
        }
        return
      }
      // Enter/leave pairs nest strictly, so a container's frame is on top of
      // the stack when its leave fires. Nodes that pushed no frame never
      // match.
      if (scopeFrames[scopeFrames.length - 1]?.container === node) {
        scopeFrames.pop()
      }
    },
  })

  return didRewire ? rewiredAst : afterDeleteAst
}
