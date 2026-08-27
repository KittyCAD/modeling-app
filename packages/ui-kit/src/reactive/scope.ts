/**
 * Ownership scopes.
 *
 * Every reactive binding this library creates (an effect, an event listener, a
 * dynamic child region) registers a disposer on the scope that is current while
 * it is created. Scopes nest, so disposing a region tears down everything that
 * was built underneath it in one call. This is what lets us hand out plain DOM
 * nodes without leaking effects when those nodes are discarded.
 */

export interface Scope {
  readonly disposers: (() => void)[]
  readonly children: Scope[]
  parent: Scope | null
  disposed: boolean
}

let currentScope: Scope | null = null

function createScope(parent: Scope | null): Scope {
  const scope: Scope = { disposers: [], children: [], parent, disposed: false }
  parent?.children.push(scope)
  return scope
}

/** Tear down a scope and everything created inside it, children first. */
export function disposeScope(scope: Scope) {
  if (scope.disposed) return
  scope.disposed = true

  for (let i = scope.children.length - 1; i >= 0; i--) {
    disposeScope(scope.children[i])
  }
  scope.children.length = 0

  // Dispose in reverse creation order so teardown mirrors setup.
  for (let i = scope.disposers.length - 1; i >= 0; i--) {
    try {
      scope.disposers[i]()
    } catch (error) {
      // One failing disposer must not strand the rest of the tree.
      console.error('ui-kit: disposer threw during teardown', error)
    }
  }
  scope.disposers.length = 0

  const siblings = scope.parent?.children
  if (siblings) {
    const index = siblings.indexOf(scope)
    if (index !== -1) siblings.splice(index, 1)
  }
  scope.parent = null
}

/**
 * Run `fn` inside a fresh child of the current scope.
 *
 * Returns the value plus a disposer. Callers that own a region of the DOM keep
 * the disposer and call it when the region goes away.
 */
export function runInScope<T>(fn: (scope: Scope) => T): {
  value: T
  scope: Scope
  dispose: () => void
} {
  const scope = createScope(currentScope)
  const previous = currentScope
  currentScope = scope
  try {
    const value = fn(scope)
    return { value, scope, dispose: () => disposeScope(scope) }
  } finally {
    currentScope = previous
  }
}

/** Run `fn` with `scope` current. Used when re-entering an existing region. */
export function withScope<T>(scope: Scope | null, fn: () => T): T {
  const previous = currentScope
  currentScope = scope
  try {
    return fn()
  } finally {
    currentScope = previous
  }
}

/**
 * Register cleanup on the current scope.
 *
 * Outside any scope this is a no-op and warns, because a binding created with
 * no owner can never be cleaned up.
 */
export function onDispose(disposer: () => void) {
  if (!currentScope) {
    if (import.meta.env?.DEV) {
      console.warn(
        'ui-kit: onDispose() called with no owning scope; the cleanup will never run. ' +
          'Create the node inside mount() or a dynamic region.'
      )
    }
    return
  }
  currentScope.disposers.push(disposer)
}

/** The scope bindings will attach to right now, if any. */
export function getCurrentScope(): Scope | null {
  return currentScope
}
