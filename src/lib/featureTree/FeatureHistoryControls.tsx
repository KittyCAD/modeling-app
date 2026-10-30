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
  hasImportedExitBinding = false,
  onChange,
  renderBlock,
}: {
  history: FeatureHistory
  disabled: boolean
  hasImportedExitBinding?: boolean
  onChange: (code: string) => void
  renderBlock: (block: FeatureBlock, suppressed: boolean) => ReactNode
}) {
  const [drag, setDrag] = useState<Drag | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const canRollback = !history.blocks.some(({ statement }) => {
    if (statement.type === 'VariableDeclaration')
      return statement.declaration.id.name === 'exit'
    if (statement.type !== 'ImportStatement') return false
    // Standard-library glob imports can only supply the built-in exit itself.
    // For project modules, inspect execution results instead of assuming every
    // wildcard import shadows exit.
    if (isGlobImport(statement))
      return statement.path.type !== 'Std' && hasImportedExitBinding
    const standardExit =
      statement.path.type === 'Std' &&
      statement.path.path.join('::') === 'std::runtime'
    if (statement.selector.type === 'List') {
      return statement.selector.items.some(
        (item) =>
          (item.alias ?? item.name).name === 'exit' &&
          !(standardExit && item.name.name === 'exit')
      )
    }
    return (
      statement.selector.type === 'None' &&
      statement.selector.alias?.name === 'exit'
    )
  })
  const visibleBlocks = history.blocks.flatMap((block, index) =>
    block.hidden ? [] : [{ block, index }]
  )
  const boundaries = [
    ...visibleBlocks.map(({ index }) => index),
    history.blocks.length,
  ]
  const activeBoundary =
    boundaries.find((index) => index >= history.rollbackIndex) ??
    history.blocks.length
  const activeBoundaryPosition = boundaries.indexOf(activeBoundary)

  function rollback(index: number) {
    if (disabled || index === history.rollbackIndex) return
    if (!canRollback && index < history.blocks.length) {
      toast.error('Rename the exit binding before using the rollback bar.')
      return
    }
    onChange(setHistoryRollback(history, index))
  }

  function boundary(index: number) {
    const active = index === activeBoundary
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
            aria-valuemax={visibleBlocks.length}
            aria-valuenow={activeBoundaryPosition}
            aria-valuetext={`${activeBoundaryPosition} of ${visibleBlocks.length} features executed`}
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
                  ? boundaries[0]
                  : event.key === 'End'
                    ? history.blocks.length
                    : event.key === 'ArrowUp'
                      ? boundaries[Math.max(0, activeBoundaryPosition - 1)]
                      : event.key === 'ArrowDown'
                        ? boundaries[
                            Math.min(
                              boundaries.length - 1,
                              activeBoundaryPosition + 1
                            )
                          ]
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
      {visibleBlocks.map(({ block, index }) => (
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
