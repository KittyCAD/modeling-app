import type { EditorViewInstance } from '@src/lib/editors/registry/contract'

/** Resolve the innermost mounted presentation, including Code surfaces hosted without a pane. */
export function editorViewForTarget(
  views: readonly EditorViewInstance[],
  target: EventTarget | null
): EditorViewInstance | undefined {
  if (!(target instanceof Node)) return
  for (let node: Node | null = target; node; node = node.parentNode) {
    const instance = views.find(
      (view) =>
        view.element.peek() === node || view.codeView.peek()?.dom === node
    )
    if (instance) return instance
  }
}
