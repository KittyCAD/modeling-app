import type { Node } from '@rust/kcl-lib/bindings/Node'
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

// Scopes whose bindings may shadow a deleted feature's name. Function scopes
// are delimited by FunctionExpression enter/leave events. Block scopes (sketch
// blocks and bare blocks) and, under KCL 3.0, if-expression arm scopes get no
// enter/leave events of their own -- traverse visits their items directly --
// so they are keyed by the path prefix shared by all of the scope's items and
// synced against the current path on every enter.
type ScopeFrame =
  | { kind: 'function'; bindings: Set<string> }
  | { kind: 'block' | 'arm'; bindings: Set<string>; pathPrefix: PathToNode }

const isPathPrefix = (prefix: PathToNode, path: PathToNode): boolean => {
  if (prefix.length > path.length) {
    return false
  }
  return prefix.every((segment, i) => segment[0] === path[i][0])
}

// Both sketch-block bodies and bare blocks tag their items with this segment.
const isBlockItemsSegment = (segment: PathToNode[number]): boolean => {
  return segment[0] === 'items' && segment[1] === 'Block'
}

// Every if/else-if/else arm body tags its items with this segment (right
// after the arm's then_val/final_else segment, so distinct arms have distinct
// prefixes). Conditions never carry it and therefore resolve in the enclosing
// scope.
const isIfArmBodySegment = (segment: PathToNode[number]): boolean => {
  return segment[0] === 'body' && segment[1] === 'IfExpression'
}

// Bring path-keyed frames in line with the node being visited: close scopes
// traversal has moved past and open scopes it has moved into. Function frames
// are managed by their own enter/leave events, but a live function frame
// guarantees every path-keyed frame below it is an enclosing scope, so
// pruning stops at the first function frame or live path-keyed frame.
const syncScopeFrames = (
  frames: ScopeFrame[],
  pathToNode: PathToNode,
  useV3ArmScoping: boolean
) => {
  while (frames.length > 0) {
    const top = frames[frames.length - 1]
    if (top.kind === 'function' || isPathPrefix(top.pathPrefix, pathToNode)) {
      break
    }
    frames.pop()
  }

  // Ascending prefix length keeps the stack ordered outermost-first. After
  // pruning, every remaining path-keyed frame prefixes the current path, so
  // matching on prefix length alone identifies an already-open scope.
  for (let i = 0; i < pathToNode.length; i++) {
    const segment = pathToNode[i]
    let kind: 'block' | 'arm'
    if (isBlockItemsSegment(segment)) {
      kind = 'block'
    } else if (useV3ArmScoping && isIfArmBodySegment(segment)) {
      // KCL 3.0: each arm body is its own scope. Under older entry points
      // arm bindings share the enclosing scope, so no frame is opened.
      kind = 'arm'
    } else {
      continue
    }
    const prefixLength = i + 1
    const alreadyOpen = frames.some(
      (frame) =>
        frame.kind !== 'function' && frame.pathPrefix.length === prefixLength
    )
    if (!alreadyOpen) {
      frames.push({
        kind,
        bindings: new Set(),
        pathPrefix: pathToNode.slice(0, prefixLength),
      })
    }
  }
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
      syncScopeFrames(scopeFrames, pathToNode, useV3ArmScoping)

      if (node.type === 'FunctionExpression') {
        const bindings = new Set(
          node.params.map((param) => param.identifier.name)
        )
        if (node.name) {
          bindings.add(node.name.name)
        }
        scopeFrames.push({ kind: 'function', bindings })
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
      if (node.type === 'FunctionExpression') {
        // Discard any path-keyed frames opened inside the function that had
        // no later sibling visit to prune them.
        while (scopeFrames.length > 0) {
          if (scopeFrames.pop()?.kind === 'function') {
            break
          }
        }
      }
    },
  })

  return didRewire ? rewiredAst : afterDeleteAst
}
