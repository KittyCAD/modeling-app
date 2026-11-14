import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { ExecState, Program } from '@src/lang/wasm'
import type { ModelingViewContext } from '@src/lib/kcl/registry/contract'
import type { KclSceneResource } from '@src/lib/kcl/scene'
import type { SelectionModel } from '@src/lib/scene/selection'

/** A tool borrows one view's successful execution. Every source edit or re-execution expires it. */
export interface KclModelSnapshot {
  contents: string
  src: string
  ast: Node<Program>
  execState: ExecState
  scene: KclSceneResource
  model: SelectionModel
  isCurrent: () => boolean
}
export function captureModel(
  context: Pick<ModelingViewContext, 'executor' | 'session'>
): KclModelSnapshot | Error {
  const { editor, output } = context.executor
  const scene = context.session.resource.peek()
  const model = scene?.selection.model.peek()
  const ast = scene?.runtime.ast.peek()
  const source = output.peek()
  if (!scene || !model || !ast)
    return new Error('Wait for the model to execute before opening a tool.')
  const isCurrent = () =>
    !editor.signal.aborted &&
    !editor.readOnly.peek() &&
    context.session.resource.peek() === scene &&
    scene.selection.model.peek() === model &&
    !scene.runtime.executing.peek() &&
    !scene.runtime.failed.peek() &&
    !output.peek().running &&
    !output.peek().errors['kcl.execution'] &&
    editor.contents.peek() === source.contents &&
    (editor.src.peek() ?? '') === source.src
  if (!isCurrent())
    return new Error(
      'Execute the current editable buffer before opening a tool.'
    )
  return {
    contents: source.contents,
    src: source.src,
    ast,
    execState: scene.runtime.state.peek(),
    scene,
    model,
    isCurrent,
  }
}
