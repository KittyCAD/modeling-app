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

// TODO: Also track tag declarators (`$tag`) and labelled expressions
// (`expr as label`) removed along with a deleted declaration. References to
// those names dangle the same way but are not detected or rewired yet.
type Deletions = {
  // Every top-level declaration removed by the delete.
  deletedNames: Set<string>
  // The subset whose initializer referenced another feature, mapped to it.
  deletedToParentMap: Map<string, string>
}

const collectDeletions = (
  beforeDeleteAst: Node<Program>,
  afterDeleteAst: Node<Program>
): Deletions => {
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

  const deletedNames = new Set<string>()
  const deletedToParentMap = new Map<string, string>()
  for (const [deletedName, declaration] of beforeDeclarationsByName) {
    if (afterDeclarationNames.has(deletedName)) {
      continue
    }
    deletedNames.add(deletedName)
    const parentName = getFirstParentReference(declaration)
    if (!parentName || parentName === deletedName) {
      continue
    }
    deletedToParentMap.set(deletedName, parentName)
  }

  return { deletedNames, deletedToParentMap }
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
): Node<Program> | Error {
  const { useV3ArmScoping } = options
  const { deletedNames, deletedToParentMap } = collectDeletions(
    beforeDeleteAst,
    afterDeleteAst
  )
  if (deletedNames.size === 0) {
    return afterDeleteAst
  }

  const rewiredAst = structuredClone(afterDeleteAst)
  let didRewire = false
  // Deleted features still referenced somewhere they cannot be rewired. Any
  // entry makes the delete unsafe to apply.
  const unresolvedNames = new Set<string>()
  const scopeFrames: ScopeFrame[] = []
  // Declarations whose binding takes effect on leave. See below.
  const pendingBindings: {
    declaration: Node<VariableDeclaration>
    frame: ScopeFrame
  }[] = []

  const isShadowed = (name: string): boolean =>
    scopeFrames.some((frame) => frame.bindings.has(name))

  // First pass is intentionally generic: if a deleted feature had a parent
  // reference, every unshadowed downstream reference gets rebound through that
  // parent chain. A reference that cannot be rebound makes the whole delete
  // unsafe, reported as an Error.
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
        // A binding is in scope only from its declaration onward: function
        // bodies, sketch blocks, and (under KCL 3.0) arm bodies all evaluate
        // the initializer in the enclosing scope before binding the name, in
        // every KCL version. So the declaration's own initializer still sees
        // the deleted feature and must be rewired (`deleted001 = deleted001 + 1`
        // becomes `deleted001 = parent001 + 1`). Register on leave, after the
        // initializer subtree has been visited.
        pendingBindings.push({
          declaration: node,
          frame: scopeFrames[scopeFrames.length - 1],
        })
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
      const name = node.name.name
      // A locally bound name was never a reference to the deleted feature.
      if (!deletedNames.has(name) || isShadowed(name)) {
        return
      }

      // This reference would dangle once the delete is applied, so it must be
      // rebound to the deleted feature's surviving ancestor. That is
      // impossible when there is no ancestor, and unsafe when an enclosing
      // scope binds the ancestor's name: writing it here would capture the
      // local value and silently change the model. Mock execution cannot be
      // relied on to catch the dangling reference later, since it only
      // validates code it runs, so report it instead.
      const replacement = resolveRewireTarget(name, deletedToParentMap)
      if (!replacement || isShadowed(replacement)) {
        unresolvedNames.add(name)
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

  if (unresolvedNames.size > 0) {
    return new Error(
      `References to deleted ${[...unresolvedNames].join(', ')} cannot be safely rewired`
    )
  }

  return didRewire ? rewiredAst : afterDeleteAst
}
