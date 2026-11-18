import * as Dialog from '@radix-ui/react-dialog'
import { ArrowRight, ChevronRight, X } from 'lucide-react'
import { useState } from 'react'
import { type Definition, type Tile, readRules } from './game'
import type { Runtime } from './registry'
import { Pixels, artwork, ink } from './tile-art'

/** The explanation reads the same installed contributions as the game and editor. */
export function PlanktonDrawer({
  runtime,
  open,
  peek,
  onOpenChange,
  onEdit,
}: {
  runtime: Runtime
  open: boolean
  peek: boolean
  onOpenChange: (open: boolean) => void
  onEdit: (definition: Definition, kind: Tile['kind']) => void
}) {
  const [selected, setSelected] = useState('BUSH')
  const definitions = runtime.definitions.value
  const definition =
    definitions.find((item) => item.id === selected) ?? definitions[0]
  const action =
    definition?.kind === 'property'
      ? runtime.actions.value.find((item) => item.id === definition.action)
      : undefined
  const relatedRules = readRules(runtime.game.board.tiles, definitions).filter(
    (rule) => rule.noun === definition?.id || rule.property === definition?.id
  )
  const picture = (item: Definition, kind: Tile['kind'] = 'word') => (
    <span className="lesson-tile" role="img" aria-label={`${item.id} ${kind}`}>
      <Pixels sprite={artwork(item, kind)} color={ink(item, kind)} />
    </span>
  )

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>
        <button
          className={`editor-edge plankton-edge ${peek ? 'peek' : ''}`}
          aria-label="How Plankton works"
        >
          <span>Plankton</span>
          <ChevronRight size={18} />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="editor-overlay" />
        <Dialog.Content className="plankton-drawer">
          <header>
            <span className="lesson-eyebrow">A living registry · paused</span>
            <Dialog.Close asChild>
              <button aria-label="Close Plankton explanation">
                <X size={18} />
              </button>
            </Dialog.Close>
          </header>
          <Dialog.Title>Plankton, under the tiles.</Dialog.Title>
          <Dialog.Description>
            Plankton brings independent extensions together. This world’s
            artwork, actions, puzzles, and outcome meanings all arrive through
            extensions—including the built-ins.
          </Dialog.Description>

          <section className="plankton-lesson">
            <h2>
              <span>01</span> A tile has a definition.
            </h2>
            <p>Pick a piece of the installed vocabulary.</p>
            <div
              className="lesson-vocabulary"
              aria-label="Inspect installed extensions"
            >
              {definitions.map((item) => (
                <button
                  key={item.id}
                  aria-label={`Explain ${item.id}`}
                  aria-pressed={definition?.id === item.id}
                  onClick={() => setSelected(item.id)}
                >
                  <Pixels
                    sprite={artwork(item, 'word')}
                    color={ink(item, 'word')}
                  />
                </button>
              ))}
            </div>
            {definition && (
              <div className="lesson-definition">
                <div className="lesson-flow">
                  {picture(definition)}
                  <ArrowRight size={16} aria-hidden="true" />
                  <div>
                    <strong>{definition.id}</strong>
                    <small>
                      {definition.kind === 'property'
                        ? 'Property definition'
                        : definition.kind === 'entity'
                          ? 'Entity definition'
                          : 'Language definition'}
                    </small>
                  </div>
                  {definition.kind === 'entity' &&
                    picture(definition, 'entity')}
                </div>
                <p>
                  {definition.kind === 'entity'
                    ? 'One definition supplies an entity sprite and its noun word. The board places copies of these tiles.'
                    : definition.kind === 'property'
                      ? `This word refers to the “${action?.label ?? definition.action}” action. That behavior is contributed separately to the actions Facet.`
                      : 'Its artwork comes from the vocabulary. The sentence parser or an outcome-meaning extension supplies its meaning.'}
                </p>
                {action && (
                  <p className="lesson-action">{action.description}</p>
                )}
                {relatedRules.length > 0 && (
                  <div
                    className="lesson-outcomes"
                    aria-label="Rules using this definition"
                  >
                    {relatedRules.map((rule, index) => (
                      <div
                        className="lesson-outcome"
                        key={index}
                        aria-label={`${rule.noun} IS ${rule.property}`}
                      >
                        {[rule.noun, 'IS', rule.property].map((id, i) => {
                          const item = definitions.find(
                            (entry) => entry.id === id
                          )
                          return item ? (
                            <span key={i}>{picture(item)}</span>
                          ) : null
                        })}
                        <small>on this board</small>
                      </div>
                    ))}
                  </div>
                )}
                <code>contribute(gameContract.definitions, …)</code>
                <button
                  className="lesson-edit"
                  onClick={() => onEdit(definition, 'word')}
                >
                  Edit {definition.id} <ArrowRight size={14} />
                </button>
              </div>
            )}
          </section>

          <section className="plankton-lesson">
            <h2>
              <span>02</span> Many extensions. One vocabulary.
            </h2>
            <div className="lesson-flow lesson-assembly">
              <div className="lesson-stack">
                {definitions.slice(0, 3).map((item) => (
                  <span key={item.id}>{picture(item)}</span>
                ))}
              </div>
              <ArrowRight size={16} aria-hidden="true" />
              <div className="lesson-container">
                <strong>definitions</strong>
                <small>Facet · {definitions.length} definitions</small>
              </div>
              <ArrowRight size={16} aria-hidden="true" />
              <span className="lesson-consumer">
                Board
                <br />
                Editor
                <br />
                Parser
              </span>
            </div>
            <p>
              A <strong>Facet</strong> collects contributions under a shared
              contract. These three consumers read the same vocabulary; none
              needs to know which extension supplied a tile.
            </p>
            <div className="lesson-totals">
              <span>
                {runtime.actions.value.length}
                <small>actions</small>
              </span>
              <span>
                {runtime.outcomeMeanings.value.length}
                <small>outcome meanings</small>
              </span>
              <span>
                {runtime.puzzles.value.length}
                <small>starter puzzles</small>
              </span>
            </div>
            <p>
              Each has its own Facet. The outcome board combines vocabulary
              tiles with contributed predicate meanings:
            </p>
            <div
              className="lesson-outcomes"
              aria-label="Installed outcome rules"
            >
              {runtime.outcomeProgram.value.rows.map((row) => (
                <div className="lesson-outcome" key={row.id}>
                  {row.cells.map((id, index) => {
                    const item = definitions.find((entry) => entry.id === id)
                    return (
                      <span key={index}>
                        {index === 3 && <span className="lesson-arrow">→</span>}
                        {item ? (
                          picture(item)
                        ) : (
                          <span className="lesson-tile">{id || '_'}</span>
                        )}
                      </span>
                    )
                  })}
                </div>
              ))}
            </div>
          </section>

          <section className="plankton-lesson">
            <h2>
              <span>03</span> Change the pieces. Keep the world.
            </h2>
            <div className="lesson-owner">
              <span className="lesson-eyebrow">
                Session Factory · owns the running game
              </span>
              <div className="lesson-flow">
                <div className="lesson-container">
                  <strong>Slot</strong>
                  <small>replaceable extensions</small>
                </div>
                <ArrowRight size={16} aria-hidden="true" />
                <div className="lesson-container">
                  <strong>Same board</strong>
                  <small>
                    {runtime.game.puzzle.bounds.width} ×{' '}
                    {runtime.game.puzzle.bounds.height} ·{' '}
                    {runtime.game.board.tiles.length} placed tiles
                  </small>
                </div>
              </div>
            </div>
            <p>
              Saving artwork replaces a definition through a{' '}
              <strong>Slot</strong>. Its key identifies the vocabulary entry;
              authored definitions take precedence over built-ins.
            </p>
            <p>
              The session <strong>Factory</strong> stays installed. Its live
              observations pick up the replacement, preserving the board and
              movement undo history. A Service exposes that same session to the
              app.
            </p>
            <p>
              Try editing a tile’s pixels, or create DIE with the Destroy self
              action and complete BUSH IS DIE. Plankton installs the
              contributions; the game interprets the rule.
            </p>
            <code>registry.replace(slot, extensions)</code>
          </section>
          <Dialog.Close asChild>
            <button className="lesson-return">Return to the world</button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
