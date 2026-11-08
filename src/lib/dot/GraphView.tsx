/* Dragology consumes these attributes before rendering DOM elements. */
/* eslint react/no-unknown-property: ["error", { "ignore": ["dragologyOnDrag", "dragologyZIndex"] }] */
import { useSignals } from '@preact/signals-react/runtime'
import { useMemo, useState, useRef } from 'react'
import { isolateHistory } from '@codemirror/commands'
import { Transaction, type ChangeSpec } from '@codemirror/state'
import { DraggableRenderer, param, translate, type Draggable } from 'dragology'
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch'
import type { Executor } from '@src/lib/executors/registry/contract'
import {
  dotExecutorCapability,
  type GraphState,
  type Endpoint,
} from '@src/lib/dot/executor'
import {
  checkedChanges,
  insertStatement,
  positionChanges,
  type DotDocument,
  type Point,
} from '@src/lib/dot/document'
import { isErr } from '@src/lib/trap'

const center = (endpoint: Endpoint, state: GraphState): Point =>
  typeof endpoint === 'string' ? state.nodes[endpoint] : endpoint

/** Render candidates from immutable graph state; Dragology owns the transient drag preview. */
/* eslint-disable react/jsx-key -- Dragology matches its SVG tree by id, and rejects React keys. */
const graphDraggable: Draggable<GraphState> = ({ state, d }) => {
  const endpointDrag = (key: string, end: 'from' | 'to') =>
    d.substate(state, ['edges', key, end], (endpoint) =>
      endpoint
        .closest(
          Object.keys(state.nodes).map((id) =>
            endpoint.dropTarget(`target-${id}`, id)
          )
        )
        .whenFar(endpoint.vary({ x: 0, y: 0 }, [param('x'), param('y')]), {
          gap: 28,
        })
    )
  return (
    <g transform={translate(600, 450)}>
      {Object.entries(state.edges).map(([key, edge], index) => {
        const a = center(edge.from, state),
          b = center(edge.to, state)
        const self = edge.from === edge.to
        const dx = b.x - a.x,
          dy = b.y - a.y
        const length = Math.hypot(dx, dy) || 1
        const end = self
          ? { x: b.x + 18, y: b.y - 22 }
          : { x: b.x - (dx / length) * 32, y: b.y - (dy / length) * 32 }
        const start = self
          ? { x: a.x - 18, y: a.y - 22 }
          : { x: a.x + (dx / length) * 32, y: a.y + (dy / length) * 32 }
        const bend =
          state.edges[key].from === state.edges[key].to ? 80 : 12 * (index % 3)
        const path = self
          ? `M ${start.x},${start.y} C ${a.x - bend},${a.y - 110} ${a.x + bend},${a.y - 110} ${end.x},${end.y}`
          : `M ${start.x},${start.y} Q ${(a.x + b.x) / 2 - (dy / length) * bend},${(a.y + b.y) / 2 + (dx / length) * bend} ${end.x},${end.y}`
        return (
          <g id={`edge-${key}`}>
            <path
              d={path}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            />
            {state.directed && (
              <path
                d="M -8,-4 L 0,0 L -8,4"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                transform={`${translate(end.x, end.y)} rotate(${self ? 70 : (Math.atan2(dy, dx) * 180) / Math.PI})`}
              />
            )}
            {edge.label && (
              <text
                id={`label-${key}`}
                dragologyZIndex={2}
                pointerEvents="none"
                x={(a.x + b.x) / 2}
                y={(a.y + b.y) / 2 - 12}
                textAnchor="middle"
                fill="currentColor"
                fontSize={12}
              >
                {edge.label}
              </text>
            )}
            {(edge.source || key === 'new-edge') && (
              <g id={`handles-${key}`}>
                <circle
                  id={`head-${key}`}
                  aria-label="Reconnect edge target"
                  transform={translate(end.x, end.y)}
                  r={7}
                  fill="currentColor"
                  className="cursor-grab opacity-40 hover:opacity-100"
                  dragologyOnDrag={() => endpointDrag(key, 'to')}
                />
                <circle
                  id={`tail-${key}`}
                  aria-label="Reconnect edge source"
                  transform={translate(start.x, start.y)}
                  r={7}
                  fill="currentColor"
                  className="cursor-grab opacity-40 hover:opacity-100"
                  dragologyOnDrag={() => endpointDrag(key, 'from')}
                />
              </g>
            )}
          </g>
        )
      })}
      {Object.entries(state.nodes).map(([key, node]) => (
        <g id={`group-${key}`} transform={translate(node.x, node.y)}>
          <circle
            id={`target-${key}`}
            pointerEvents="none"
            r={48}
            fill="transparent"
            dragologyZIndex={-1}
          />
          <circle
            id={`node-${key}`}
            aria-label={`Move ${node.name}`}
            r={30}
            className="cursor-grab"
            fill="var(--dot-node-fill)"
            stroke="currentColor"
            strokeWidth={1.5}
            dragologyOnDrag={() =>
              d.vary(state, [
                param('nodes', key, 'x'),
                param('nodes', key, 'y'),
              ])
            }
          />
          <text
            id={`label-${key}`}
            dragologyZIndex={2}
            textAnchor="middle"
            dominantBaseline="central"
            fill="currentColor"
            fontSize={12}
            pointerEvents="none"
          >
            {node.label}
          </text>
          <circle
            id={`connect-${key}`}
            aria-label={`Connect from ${node.name}`}
            transform={translate(26, -22)}
            r={7}
            fill="currentColor"
            className="cursor-crosshair"
            dragologyOnDrag={() =>
              d.switchToStateAndFollow(
                {
                  ...state,
                  edges: {
                    ...state.edges,
                    'new-edge': {
                      from: key,
                      to: { x: node.x, y: node.y },
                      label: '',
                    },
                  },
                },
                'head-new-edge'
              )
            }
          />
        </g>
      ))}
    </g>
  )
}

/* eslint-enable react/jsx-key */

/** Graph gestures dispatch source edits, retaining the shared buffer's undo and save behavior. */
export function GraphView({ executor }: { executor: Executor }) {
  useSignals()
  const output = executor.output.value
  const result = output.get(dotExecutorCapability)
  const previous = useRef<
    | {
        result: NonNullable<typeof result>
        contents: string
      }
    | undefined
  >(undefined)
  if (result) previous.current = { result, contents: output.contents }
  const available = result
    ? { result, contents: output.contents }
    : previous.current
  const error = output.errors[dotExecutorCapability.id]
  const [editError, setEditError] = useState<Error>()
  if (error)
    return (
      <p role="alert" className="p-4 text-sm">
        {error.message}
      </p>
    )
  if (!available)
    return (
      <p role="status" className="p-4 text-sm">
        Laying out graph...
      </p>
    )
  return (
    <GraphCanvas
      executor={executor}
      graph={available.result.graph}
      document={available.result.document}
      contents={available.contents}
      error={editError}
      setError={setEditError}
    />
  )
}

function GraphCanvas({
  executor,
  graph,
  document,
  contents,
  error,
  setError,
}: {
  executor: Executor
  graph: GraphState
  document: DotDocument
  contents: string
  error?: Error
  setError: (error: Error | undefined) => void
}) {
  const [dragging, setDragging] = useState(false)
  const gesture = useRef<{ state: GraphState; contents: string } | undefined>(
    undefined
  )
  const commit = (changes: ChangeSpec[]) => {
    if (executor.editor.contents.peek() !== contents) {
      setError(new Error('The source changed during this gesture. Try again.'))
      return
    }
    const checked = checkedChanges(contents, changes)
    if (isErr(checked)) {
      setError(checked)
      return
    }
    setError(undefined)
    executor.editor.dispatch({
      changes: checked,
      annotations: [
        Transaction.userEvent.of('input.graph'),
        isolateHistory.of('full'),
      ],
    })
  }
  const drop = (next: GraphState) => {
    const started = gesture.current
    gesture.current = undefined
    if (started && (started.state !== graph || started.contents !== contents)) {
      setError(new Error('The source changed during this gesture. Try again.'))
      return
    }
    const changes: ChangeSpec[] = []
    const positions = new Map(
      Object.values(next.nodes).map((node) => [
        node.name,
        { x: node.x, y: node.y },
      ])
    )
    if (
      Object.keys(graph.nodes).some(
        (key) =>
          graph.nodes[key].x !== next.nodes[key].x ||
          graph.nodes[key].y !== next.nodes[key].y
      )
    )
      changes.push(...positionChanges(contents, document, positions))
    for (const [key, edge] of Object.entries(next.edges)) {
      if (typeof edge.from !== 'string' || typeof edge.to !== 'string') continue
      const from = document.ids.get(next.nodes[edge.from].name),
        to = document.ids.get(next.nodes[edge.to].name)
      if (!from || !to) continue
      if (key === 'new-edge')
        changes.push(
          insertStatement(
            contents,
            document,
            `${from} ${graph.directed ? '->' : '--'} ${to};`
          )
        )
      else if (edge.source) {
        if (edge.from !== graph.edges[key].from)
          changes.push({ ...edge.source.from, insert: from })
        if (edge.to !== graph.edges[key].to)
          changes.push({ ...edge.source.to, insert: to })
      }
    }
    if (changes.length) commit(changes)
  }
  const size = useMemo(
    () => ({
      width: Math.max(
        1400,
        ...Object.values(graph.nodes).map((node) => node.x + 800)
      ),
      height: Math.max(
        1000,
        ...Object.values(graph.nodes).map((node) => node.y + 650)
      ),
    }),
    [graph]
  )
  return (
    <div className="flex h-full w-full min-w-0 flex-col [--dot-node-fill:white] dark:[--dot-node-fill:#252525]">
      <header className="flex shrink-0 items-center gap-3 border-b b-4 px-3 py-2 text-xs">
        <button
          type="button"
          onClick={() => {
            let index = 1
            while (document.ids.has(`node${index}`)) index++
            commit([insertStatement(contents, document, `node${index};`)])
          }}
        >
          Add node
        </button>
        <span className="text-2">
          Drag nodes to position. Drag a node's small handle to connect. Scroll
          to zoom; middle-drag to pan.
        </span>
      </header>
      {error && (
        <p role="alert" className="p-2 text-sm">
          {error.message}
        </p>
      )}
      {!Object.keys(graph.nodes).length && (
        <p className="p-4 text-sm">
          This graph has no nodes yet. Add one to get started.
        </p>
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden [&_svg]:overflow-visible">
        <TransformWrapper
          minScale={0.1}
          maxScale={4}
          initialScale={0.8}
          initialPositionX={-100}
          initialPositionY={-80}
          limitToBounds={false}
          centerZoomedOut={false}
          doubleClick={{ disabled: true }}
          panning={{
            disabled: dragging,
            allowLeftClickPan: false,
            allowMiddleClickPan: true,
          }}
        >
          <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }}>
            <DraggableRenderer
              draggable={graphDraggable}
              state={graph}
              width={size.width}
              height={size.height}
              onDropState={drop}
              onDragStatus={(status) => {
                if (
                  status.type === 'dragging' &&
                  gesture.current?.state !== status.startState
                )
                  gesture.current = { state: status.startState, contents }
                setDragging(status.type === 'dragging')
              }}
            />
          </TransformComponent>
        </TransformWrapper>
      </div>
    </div>
  )
}
