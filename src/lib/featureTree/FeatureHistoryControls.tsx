import {
  type FeatureBlock,
  type FeatureHistory,
  isGlobImport,
  reorderHistoryBlock,
  setHistoryRollback,
} from '@src/lib/featureTree/featureHistory'
import { Fragment, useState, type ReactNode } from 'react'
import toast from 'react-hot-toast'

type Drag = { code: string } & (
  | { type: 'rollback' }
  | { type: 'feature'; index: number }
)

/** Drag handles are separate from operation selection, menus and disclosures. */
export function FeatureHistoryControls({
  history,
  disabled,
  onChange,
  renderBlock,
}: {
  history: FeatureHistory
  disabled: boolean
  onChange: (code: string) => void
  renderBlock: (block: FeatureBlock, suppressed: boolean) => ReactNode
}) {
  const [drag, setDrag] = useState<Drag | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const canRollback = !history.blocks.some((block) =>
    block.statement.type === 'VariableDeclaration'
      ? block.statement.declaration.id.name === 'exit'
      : block.statement.type === 'ImportStatement' &&
        (isGlobImport(block.statement) ||
          (block.statement.selector.type === 'List' &&
            block.statement.selector.items.some(
              (item) => (item.alias ?? item.name).name === 'exit'
            )) ||
          (block.statement.selector.type === 'None' &&
            block.statement.selector.alias?.name === 'exit'))
  )

  function rollback(index: number) {
    if (disabled || index === history.rollbackIndex) return
    if (!canRollback && index < history.blocks.length) {
      toast.error('Rename the exit binding before using the rollback bar.')
      return
    }
    onChange(setHistoryRollback(history, index))
  }

  function boundary(index: number) {
    const active = index === history.rollbackIndex
    return (
      <div
        className={`relative h-3 flex items-center ${disabled ? 'opacity-40' : ''}`}
        data-testid={`feature-tree-boundary-${index}`}
        onDragOver={(event) => {
          if (!drag || disabled || drag.code !== history.code) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          setDropIndex(index)
        }}
        onDragLeave={() => setDropIndex(null)}
        onDrop={(event) => {
          if (!drag || disabled || drag.code !== history.code) return
          event.preventDefault()
          if (drag.type === 'rollback') {
            rollback(index)
          } else {
            const result = reorderHistoryBlock(history, drag.index, index)
            if (result instanceof Error) toast.error(result.message)
            else onChange(result)
          }
          setDrag(null)
          setDropIndex(null)
        }}
      >
        {active && (
          <div
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label="Rollback bar"
            aria-valuemin={0}
            aria-valuemax={history.blocks.length}
            aria-valuenow={index}
            aria-valuetext={`${index} of ${history.blocks.length} KCL blocks executed`}
            aria-disabled={disabled}
            title="Drag to roll back. Use arrow keys to move; End restores all features."
            draggable={!disabled}
            onDragStart={(event) => {
              if (disabled) return event.preventDefault()
              event.dataTransfer.setData('text/plain', 'ZDS rollback bar')
              event.dataTransfer.effectAllowed = 'move'
              setDrag({ type: 'rollback', code: history.code })
            }}
            onDragEnd={() => {
              setDrag(null)
              setDropIndex(null)
            }}
            onKeyDown={(event) => {
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? history.blocks.length
                    : event.key === 'ArrowUp'
                      ? Math.max(0, index - 1)
                      : event.key === 'ArrowDown'
                        ? Math.min(history.blocks.length, index + 1)
                        : undefined
              if (next === undefined) return
              event.preventDefault()
              rollback(next)
            }}
            className="absolute inset-0 cursor-ns-resize flex items-center px-1 focus-visible:outline focus-visible:outline-primary"
          >
            <div className="h-0.5 w-full bg-primary" />
          </div>
        )}
        {dropIndex === index && (
          <div className="pointer-events-none h-0.5 w-full bg-primary" />
        )}
      </div>
    )
  }

  return (
    <div data-testid="feature-tree-history">
      {history.blocks.map((block, index) => (
        <Fragment key={block.start}>
          {boundary(index)}
          <div className="flex items-start" data-feature-block={index}>
            <button
              type="button"
              className="reset shrink-0 px-0.5 cursor-grab text-2 disabled:opacity-30 disabled:cursor-default"
              aria-label={`Move ${block.label}`}
              title={
                block.stage && block.stage.index > 0
                  ? 'Drag to reorder this pipeline stage. Alt+Up or Alt+Down moves one stage.'
                  : 'Drag to move this KCL block. Alt+Up or Alt+Down moves one block.'
              }
              disabled={disabled || !block.movable}
              draggable={!disabled && block.movable}
              onDragStart={(event) => {
                event.dataTransfer.setData('text/plain', block.label)
                event.dataTransfer.effectAllowed = 'move'
                setDrag({ type: 'feature', index, code: history.code })
              }}
              onDragEnd={() => {
                setDrag(null)
                setDropIndex(null)
              }}
              onKeyDown={(event) => {
                if (
                  !event.altKey ||
                  !['ArrowUp', 'ArrowDown'].includes(event.key)
                )
                  return
                event.preventDefault()
                let before = event.key === 'ArrowUp' ? index - 1 : index + 2
                if (!block.stage || block.stage.index === 0) {
                  if (event.key === 'ArrowUp') {
                    if (index === 0) return
                    while (
                      before > 0 &&
                      (history.blocks[before].stage?.index ?? 0) > 0
                    )
                      before--
                  } else {
                    let next = index + 1
                    while (
                      block.stage &&
                      history.blocks[next]?.stage?.pipeline ===
                        block.stage.pipeline
                    )
                      next++
                    if (next === history.blocks.length) return
                    const nextPipeline = history.blocks[next].stage?.pipeline
                    before = next + 1
                    while (
                      nextPipeline !== undefined &&
                      history.blocks[before]?.stage?.pipeline === nextPipeline
                    )
                      before++
                  }
                }
                const result = reorderHistoryBlock(history, index, before)
                if (result instanceof Error) toast.error(result.message)
                else onChange(result)
              }}
            >
              <span aria-hidden>:</span>
            </button>
            <div
              className={`min-w-0 flex-1 ${index >= history.rollbackIndex ? 'opacity-40' : ''}`}
            >
              {renderBlock(block, index >= history.rollbackIndex)}
            </div>
          </div>
        </Fragment>
      ))}
      {boundary(history.blocks.length)}
    </div>
  )
}
