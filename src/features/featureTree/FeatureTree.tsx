import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { Icon } from '@kittycad/ui-kit'
import { useComputed } from '@preact/signals'
import { useService } from '@src/app/context'
import { kclSceneService } from '@src/contracts/kclScene'
import { modelingOperationsService } from '@src/contracts/modelingOperationsService'
import { projectSessionService } from '@src/contracts/projectSession'
import type { OperationTreeNode } from '@src/features/featureTree/operationTree'
import {
  buildOperationTree,
  operationIcon,
  operationKind,
  operationLabel,
} from '@src/features/featureTree/operationTree'
import {
  editableFeatureFor,
  rollbackBeforeFeature,
  rollbackExitRange,
} from '@src/features/featureTree/rollbackEdit'
import { bufferOrigin, requestFocus } from '@src/lib/buffers/annotations'
import { sourceRangeToUtf16 } from '@src/lib/kcl/sourceRange'
import { useState } from 'preact/hooks'
import './featureTree.css'

function FeatureNode({
  node,
  source,
  selectedOffset,
  reveal,
  edit,
}: {
  node: OperationTreeNode
  source: string
  selectedOffset: number | null
  reveal: (node: OperationTreeNode) => void
  edit: (node: OperationTreeNode) => void
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
            onDblClick={() => edit(node)}
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
                edit={edit}
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
        onDblClick={() => edit(node)}
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
  const modeling = useService(modelingOperationsService)
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

  const edit = (node: OperationTreeNode) => {
    const runtime = node.operation
    if (node.moduleId !== 0 || runtime.type !== 'StdLibCall') {
      return
    }

    const program = scene.program.peek()
    const session = sessions.current.peek()
    const buffer = session?.executingBuffer.peek()
    if (
      !program ||
      !session ||
      !buffer ||
      buffer.text.peek() !== program.source
    ) {
      return
    }

    session.setActiveBuffer(buffer.id)
    const operation = modeling.available
      .peek()
      .find((candidate) => candidate.stdlib === runtime.name)
    if (!operation) {
      return
    }

    const feature = editableFeatureFor(
      program.source,
      program.ast,
      runtime,
      operation
    )
    if (!feature) {
      return
    }

    const rollback = rollbackBeforeFeature(program.source, feature)
    buffer.dispatch({
      changes: rollback.changes.map((change) => ({
        from: change.from,
        to: change.to,
        insert: change.insert,
      })),
      annotations: bufferOrigin.of('semantic'),
    })
    void modeling.startEdit(
      feature.operationId,
      feature.answers,
      rollback.target
    )
  }

  if (!scene.program.value) {
    return (
      <p class="zds-feature-tree__empty">
        Run the executing KCL buffer to see its features.
      </p>
    )
  }

  const rollback = rollbackExitRange(scene.program.value.source)

  if (tree.value.length === 0 && !rollback) {
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
            edit={edit}
          />
        ))}
      </ul>
      {rollback ? (
        <div class="zds-feature-tree__rollback">
          <span>Rollback</span>
        </div>
      ) : null}
    </nav>
  )
}
