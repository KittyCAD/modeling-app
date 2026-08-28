import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { Icon, useTooltip } from '@kittycad/ui-kit'
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
  moveRollbackBoundary,
  rollbackBeforeFeature,
  rollbackExitRange,
} from '@src/features/featureTree/rollbackEdit'
import {
  type SourceOutlineNode,
  sourceOutlineAfter,
} from '@src/features/featureTree/sourceOutline'
import { bufferOrigin, requestFocus } from '@src/lib/buffers/annotations'
import { sourceRangeToUtf16 } from '@src/lib/kcl/sourceRange'
import { Fragment, type JSX } from 'preact'
import { useState } from 'preact/hooks'
import './featureTree.css'

function FeatureNode({
  node,
  source,
  selectedOffset,
  reveal,
  edit,
  inactive = false,
  onDragOver,
  onDrop,
}: {
  node: OperationTreeNode
  source: string
  selectedOffset: number | null
  reveal: (node: OperationTreeNode) => void
  edit: (node: OperationTreeNode) => void
  inactive?: boolean
  onDragOver?: JSX.DragEventHandler<HTMLLIElement>
  onDrop?: JSX.DragEventHandler<HTMLLIElement>
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
      <li
        class="zds-feature-tree__node"
        data-inactive={inactive ? 'true' : undefined}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
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
    <li
      class="zds-feature-tree__node"
      data-inactive={inactive ? 'true' : undefined}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
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

function SourceFeatureNode({
  node,
  reveal,
  inactive,
  onDragOver,
  onDrop,
}: {
  node: SourceOutlineNode
  reveal: (node: SourceOutlineNode) => void
  inactive: boolean
  onDragOver?: JSX.DragEventHandler<HTMLLIElement>
  onDrop?: JSX.DragEventHandler<HTMLLIElement>
}) {
  return (
    <li
      class="zds-feature-tree__node"
      data-inactive={inactive ? 'true' : undefined}
      data-source-outline="true"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <button
        type="button"
        class="zds-feature-tree__row"
        aria-description="Not executed past the rollback boundary"
        onClick={() => reveal(node)}
      >
        <span class="zds-feature-tree__disclosure-spacer" />
        <Icon name={node.icon} size="small" />
        <span class="zds-feature-tree__label">{node.label}</span>
        <span class="zds-feature-tree__kind">{node.kind}</span>
      </button>
    </li>
  )
}

function RollbackBar({
  preview,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  preview: boolean
  dragging?: boolean
  onDragStart?: JSX.DragEventHandler<HTMLButtonElement>
  onDragEnd?: JSX.DragEventHandler<HTMLButtonElement>
}) {
  const tooltip = useTooltip<HTMLButtonElement>({
    content: 'Rollback bar',
    description: 'Drag to choose how far the KCL program executes.',
    placement: 'right',
    delay: 500,
  })

  if (preview) {
    return (
      <li class="zds-feature-tree__rollback-slot" role="presentation">
        <div
          class="zds-feature-tree__rollback"
          data-preview="true"
          aria-hidden="true"
        >
          <span />
        </div>
      </li>
    )
  }

  return (
    <li class="zds-feature-tree__rollback-slot" role="presentation">
      <button
        ref={tooltip}
        type="button"
        class="zds-feature-tree__rollback"
        data-dragging={dragging ? 'true' : undefined}
        draggable
        aria-label="Rollback bar"
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <span />
      </button>
    </li>
  )
}

type DisplayNode =
  | {
      key: string
      type: 'runtime'
      node: OperationTreeNode
      rollbackInsertion: number
    }
  | {
      key: string
      type: 'source'
      node: SourceOutlineNode
      rollbackInsertion: number
    }

const startOfLine = (source: string, offset: number) =>
  source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1

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
  const [draggingRollback, setDraggingRollback] = useState(false)
  const [previewSlot, setPreviewSlot] = useState<number | null>(null)

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

  const revealSource = (node: SourceOutlineNode) => {
    const session = sessions.current.peek()
    const buffer = session?.executingBuffer.peek()
    if (!session || !buffer) {
      return
    }
    const length = buffer.state.peek().doc.length
    const from = Math.min(node.statement.from, length)
    const to = Math.min(Math.max(node.statement.to, from), length)

    session.setActiveBuffer(buffer.id)
    buffer.dispatch({
      selection: EditorSelection.range(from, to),
      effects: EditorView.scrollIntoView(from, { y: 'center' }),
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

  const program = scene.program.value
  const rollback = rollbackExitRange(program.source)
  const runtimeNodes: DisplayNode[] = tree.value.map((node) => {
    const [from] = sourceRangeToUtf16(
      program.source,
      node.operation.sourceRange
    )
    return {
      key: node.key,
      type: 'runtime',
      node,
      rollbackInsertion: startOfLine(program.source, from),
    }
  })
  const sourceNodes: DisplayNode[] = rollback
    ? sourceOutlineAfter(program.source, program.ast, rollback.to).map(
        (node) => ({
          key: node.key,
          type: 'source' as const,
          node,
          rollbackInsertion: node.rollbackInsertion,
        })
      )
    : []
  const nodes = [...runtimeNodes, ...sourceNodes]
  const actualSlot = rollback ? runtimeNodes.length : nodes.length
  const displayedSlot = draggingRollback
    ? (previewSlot ?? actualSlot)
    : actualSlot

  const beginRollbackDrag: JSX.DragEventHandler<HTMLButtonElement> = (
    event
  ) => {
    const transfer = event.dataTransfer
    if (!transfer) {
      return
    }
    transfer.setData('application/zoo-rollback-bar', 'true')
    transfer.effectAllowed = 'move'
    const dragImage = document.createElement('canvas')
    dragImage.width = 1
    dragImage.height = 1
    transfer.setDragImage(dragImage, 0, 0)
    setDraggingRollback(true)
    setPreviewSlot(actualSlot)
  }

  const endRollbackDrag = () => {
    setDraggingRollback(false)
    setPreviewSlot(null)
  }

  const previewRollbackAt = (
    event: JSX.TargetedDragEvent<HTMLLIElement>,
    index: number
  ) => {
    if (!draggingRollback) {
      return
    }
    event.preventDefault()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move'
    }
    const bounds = event.currentTarget.getBoundingClientRect()
    setPreviewSlot(
      event.clientY < bounds.top + bounds.height / 2 ? index : index + 1
    )
  }

  const dropRollback = (
    event: JSX.TargetedDragEvent<HTMLLIElement>,
    index: number
  ) => {
    if (!draggingRollback) {
      return
    }
    event.preventDefault()
    const session = sessions.current.peek()
    const buffer = session?.executingBuffer.peek()
    if (!buffer || buffer.text.peek() !== program.source) {
      endRollbackDrag()
      return
    }
    const slot = previewSlot ?? index
    const insertion =
      slot >= nodes.length ? null : nodes[slot].rollbackInsertion
    const changes = moveRollbackBoundary(program.source, insertion)
    if (changes.length > 0) {
      buffer.dispatch({
        changes: changes.map((change) => ({
          from: change.from,
          to: change.to,
          insert: change.insert,
        })),
        annotations: bufferOrigin.of('semantic'),
      })
    }
    endRollbackDrag()
  }

  if (nodes.length === 0 && !rollback) {
    return <p class="zds-feature-tree__empty">No modeling operations yet.</p>
  }

  return (
    <nav class="zds-feature-tree" aria-label="Features">
      <ul class="zds-feature-tree__list">
        {nodes.map((entry, index) => (
          <Fragment key={entry.key}>
            {actualSlot === index ? (
              <RollbackBar
                key="rollback"
                preview={false}
                dragging={draggingRollback}
                onDragStart={beginRollbackDrag}
                onDragEnd={endRollbackDrag}
              />
            ) : null}
            {draggingRollback &&
            displayedSlot !== actualSlot &&
            displayedSlot === index ? (
              <RollbackBar key="rollback-preview" preview />
            ) : null}
            {entry.type === 'runtime' ? (
              <FeatureNode
                key={entry.key}
                node={entry.node}
                source={program.source}
                selectedOffset={selectedOffset.value}
                reveal={reveal}
                edit={edit}
                inactive={index >= displayedSlot}
                onDragOver={(event) => previewRollbackAt(event, index)}
                onDrop={(event) => dropRollback(event, index)}
              />
            ) : (
              <SourceFeatureNode
                key={entry.key}
                node={entry.node}
                reveal={revealSource}
                inactive={index >= displayedSlot}
                onDragOver={(event) => previewRollbackAt(event, index)}
                onDrop={(event) => dropRollback(event, index)}
              />
            )}
          </Fragment>
        ))}
        {actualSlot === nodes.length ? (
          <RollbackBar
            preview={false}
            dragging={draggingRollback}
            onDragStart={beginRollbackDrag}
            onDragEnd={endRollbackDrag}
          />
        ) : null}
        {draggingRollback &&
        displayedSlot !== actualSlot &&
        displayedSlot === nodes.length ? (
          <RollbackBar preview />
        ) : null}
      </ul>
    </nav>
  )
}
