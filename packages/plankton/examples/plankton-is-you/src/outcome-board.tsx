import { Plus, Trash2, Undo2 } from 'lucide-react'
import type { ReactNode } from 'react'
import type { OutcomeRow, OutcomeWord } from './outcomes'

export type OutcomeCell = { rowId: string; index: 0 | 1 | 2 | 3 }
const positions = ['subject', 'predicate', 'target', 'result'] as const
export function OutcomeBoard({
  rows,
  words,
  busy,
  dirty,
  canUndo,
  renderWord,
  selected,
  onSelect,
  onChange,
  onApply,
  onUndo,
  onRestore,
}: {
  rows: readonly OutcomeRow[]
  words: readonly OutcomeWord[]
  busy: boolean
  dirty: boolean
  canUndo: boolean
  selected?: OutcomeCell
  renderWord(word: OutcomeWord): ReactNode
  onSelect(cell: OutcomeCell): void
  onChange(rows: readonly OutcomeRow[]): void
  onApply(): void
  onUndo(): void
  onRestore(): void
}) {
  return (
    <section className="outcome-board" aria-label="Outcome board">
      <div className="outcome-heading">
        <h2>Outcome board</h2>
        <button disabled={busy || !dirty} onClick={onApply}>
          Apply outcomes
        </button>
      </div>
      <p className="field-hint">
        Edit a tile or remove a row. Apply installs the whole program; LOSE
        takes priority.
      </p>
      <div className="outcome-rows">
        {rows.map((row, rowIndex) => (
          <div className="outcome-row" key={row.id}>
            {([0, 1, 2] as const).map((index) => {
              const word = words.find((w) => w.id === row.cells[index])
              return (
                <button
                  key={index}
                  aria-pressed={
                    selected?.rowId === row.id && selected.index === index
                  }
                  disabled={busy}
                  aria-label={`Outcome row ${rowIndex + 1} ${positions[index]}: ${row.cells[index] || 'empty'}`}
                  onClick={() => onSelect({ rowId: row.id, index })}
                >
                  {word ? renderWord(word) : <span>·</span>}
                </button>
              )
            })}
            <span className="outcome-arrow" aria-hidden="true">
              →
            </span>
            <button
              disabled={busy}
              aria-pressed={selected?.rowId === row.id && selected.index === 3}
              aria-label={`Outcome row ${rowIndex + 1} result: ${row.cells[3] || 'empty'}`}
              onClick={() => onSelect({ rowId: row.id, index: 3 })}
            >
              {(() => {
                const word = words.find((w) => w.id === row.cells[3])
                return word ? renderWord(word) : <span>·</span>
              })()}
            </button>
            <button
              className="remove-row"
              disabled={busy}
              aria-label={`Remove outcome row ${rowIndex + 1}`}
              onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      {rows.length === 0 && (
        <p className="field-hint">
          No outcome rows. The world can continue without YOU.
        </p>
      )}
      <div className="outcome-tools">
        <button
          disabled={busy}
          onClick={() =>
            onChange([
              ...rows,
              { id: crypto.randomUUID(), cells: ['YOU', 'IS', 'NONE', 'LOSE'] },
            ])
          }
        >
          <Plus size={13} />
          Add row
        </button>
        <button disabled={busy || !canUndo} onClick={onUndo}>
          <Undo2 size={13} />
          Undo edit
        </button>
        <button disabled={busy} onClick={onRestore}>
          Restore defaults
        </button>
      </div>
      {dirty && (
        <p className="field-hint">Draft changes have not been applied.</p>
      )}
    </section>
  )
}
