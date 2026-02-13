// The patch below is adapted from https://github.com/facebook/react/issues/11538#issuecomment-417504600
export default function monkeyPatchForBrowserTranslation() {
  if (typeof Node === 'function' && Node.prototype) {
    // Intentionally changing `this`, so no need to bind.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalRemoveChild = Node.prototype.removeChild
    Node.prototype.removeChild = function <T extends Node>(
      this: Node,
      child: T
    ): T {
      if (child.parentNode !== this) {
        if (console) {
          console.error(
            'Cannot remove a child from a different parent',
            child,
            this
          )
        }
        return child
      }
      return originalRemoveChild.call(this, child) as T
    }

    // Intentionally changing `this`, so no need to bind.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalInsertBefore = Node.prototype.insertBefore
    Node.prototype.insertBefore = function <T extends Node>(
      this: Node,
      newNode: T,
      referenceNode: Node | null
    ): T {
      if (referenceNode && referenceNode.parentNode !== this) {
        if (console) {
          console.error(
            'Cannot insert before a reference node from a different parent',
            referenceNode,
            this
          )
        }
        return newNode
      }
      return originalInsertBefore.call(this, newNode, referenceNode) as T
    }
  }
}
