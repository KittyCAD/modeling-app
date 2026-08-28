import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { Icon } from '@kittycad/ui-kit'
import { useComputed } from '@preact/signals'
import { useService } from '@src/app/context'
import { kclSceneService } from '@src/contracts/kclScene'
import { projectSessionService } from '@src/contracts/projectSession'
import type { OperationTreeNode } from '@src/features/featureTree/operationTree'
import {
  buildOperationTree,
  operationIcon,
  operationKind,
  operationLabel,
} from '@src/features/featureTree/operationTree'
import { bufferOrigin, requestFocus } from '@src/lib/buffers/annotations'
import { sourceRangeToUtf16 } from '@src/lib/kcl/sourceRange'
import { useState } from 'preact/hooks'
import './featureTree.css'

function FeatureNode({
  node,
  source,
  selectedOffset,
  reveal,
}: {
  node: OperationTreeNode
  source: string
  selectedOffset: number | null
  reveal: (node: OperationTreeNode) => void
}) {
  // Imported modules are useful context but can contain whole models. Folding
  // them initially keeps the executing file's own timeline in view; structural
  // groups within that file open because their contents are the feature.
  const [open, setOpen] = useState(node.operation.type !== 'ModuleInstance')
  const range = sourceRangeToUtf16(source, node.operation.sourceRange)
  const selected =
    node.moduleId === 0 &&
    selectedOffset !== null &&
    selectedOffset >= range[0] &&
    selectedOffset <= range[1]
  const row = (
    <>
      <Icon name={operationIcon(node.operation)} size="small" />
      <span class="zds-feature-tree__label">
        {operationLabel(node.operation)}
      </span>
      <span class="zds-feature-tree__kind">
        {operationKind(node.operation)}
      </span>
      {node.operation.type === 'StdLibCall' && node.operation.isError ? (
        <Icon name="error" size="small" label="Execution error" />
      ) : null}
    </>
  )

  if (node.children.length > 0) {
    return (
      <li class="zds-feature-tree__node">
        <div
          class="zds-feature-tree__row zds-feature-tree__row--branch"
          aria-current={selected ? 'true' : undefined}
        >
          <button
            type="button"
            class="zds-feature-tree__disclosure-button"
            aria-expanded={open}
            aria-label={`Toggle ${operationLabel(node.operation)}`}
            onClick={() => setOpen((current) => !current)}
          >
            <Icon
              name="chevronRight"
              size="small"
              class="zds-feature-tree__disclosure"
            />
          </button>
          <button
            type="button"
            class="zds-feature-tree__branch-target"
            onClick={() => reveal(node)}
          >
            {row}
          </button>
        </div>
        {open ? (
          <ul class="zds-feature-tree__children">
            {node.children.map((child) => (
              <FeatureNode
                key={child.key}
                node={child}
                source={source}
                selectedOffset={selectedOffset}
                reveal={reveal}
              />
            ))}
          </ul>
        ) : null}
      </li>
    )
  }

  return (
    <li class="zds-feature-tree__node">
      <button
        type="button"
        class="zds-feature-tree__row"
        aria-current={selected ? 'true' : undefined}
        onClick={() => reveal(node)}
        disabled={node.moduleId !== 0}
      >
        <span class="zds-feature-tree__disclosure-spacer" />
        {row}
      </button>
    </li>
  )
}

/** The KCL operation timeline belonging to the scene's executing buffer. */
export function FeatureTree() {
  const scene = useService(kclSceneService)
  const sessions = useService(projectSessionService)
  const tree = useComputed(() => buildOperationTree(scene.operations.value))
  const selectedOffset = useComputed(
    () =>
      sessions.current.value?.executingBuffer.value?.state.value.selection.main
        .head ?? null
  )

  const reveal = (node: OperationTreeNode) => {
    if (node.moduleId !== 0) {
      return
    }

    const program = scene.program.peek()
    const session = sessions.current.peek()
    const buffer = session?.executingBuffer.peek()
    if (!program || !session || !buffer) {
      return
    }

    const [from, to] = sourceRangeToUtf16(
      program.source,
      node.operation.sourceRange
    )
    const length = buffer.state.peek().doc.length
    const safeFrom = Math.min(from, length)
    const safeTo = Math.min(Math.max(to, safeFrom), length)

    session.setActiveBuffer(buffer.id)
    buffer.dispatch({
      selection: EditorSelection.range(safeFrom, safeTo),
      effects: EditorView.scrollIntoView(safeFrom, { y: 'center' }),
      annotations: [bufferOrigin.of('semantic'), requestFocus.of(true)],
    })
  }

  if (!scene.program.value) {
    return (
      <p class="zds-feature-tree__empty">
        Run the executing KCL buffer to see its features.
      </p>
    )
  }

  if (tree.value.length === 0) {
    return <p class="zds-feature-tree__empty">No modeling operations yet.</p>
  }

  return (
    <nav class="zds-feature-tree" aria-label="Features">
      <ul class="zds-feature-tree__list">
        {tree.value.map((node) => (
          <FeatureNode
            key={node.key}
            node={node}
            source={scene.program.value?.source ?? ''}
            selectedOffset={selectedOffset.value}
            reveal={reveal}
          />
        ))}
      </ul>
    </nav>
  )
}
