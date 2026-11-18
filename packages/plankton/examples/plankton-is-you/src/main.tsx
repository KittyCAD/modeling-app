import * as Dialog from '@radix-ui/react-dialog'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Braces,
  Check,
  ChevronRight,
  Code2,
  Eraser,
  Flag,
  Layers,
  Pencil,
  Plus,
  RotateCcw,
  Undo2,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { compileProperty, type PropertyRecipe } from './content'
import {
  type Definition,
  type EntityDefinition,
  readRules,
  type Sprite,
} from './game'
import { gameContract, openGame, type Runtime } from './registry'
import './style.css'

function SpriteView({ sprite, color }: { sprite: Sprite; color: string }) {
  return (
    <svg viewBox="0 0 8 8" aria-hidden="true" shapeRendering="crispEdges">
      {sprite.flatMap((row, y) =>
        [...row].map((pixel, x) =>
          pixel === '1' ? (
            <rect
              key={`${x}-${y}`}
              x={x}
              y={y}
              width="1"
              height="1"
              fill={color}
            />
          ) : null
        )
      )}
    </svg>
  )
}

function App({ runtime }: { runtime: Runtime }) {
  const boardRef = useRef<HTMLDivElement>(null)
  const [, render] = useState(0)
  const refresh = () => render((n) => n + 1)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'sprite' | 'behavior' | 'extension'>('sprite')
  const [selected, setSelected] = useState<{
    kind: 'entity' | 'word'
    type: string
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [name, setName] = useState('BUSH')
  const bush = runtime.definitions.value.find(
    (d): d is EntityDefinition => d.kind === 'entity' && d.id === 'BUSH'
  )!
  const [sprite, setSprite] = useState<Sprite>(bush.sprite)
  const [color, setColor] = useState(bush.color)
  const [propertyName, setPropertyName] = useState('DIE')
  const [action, setAction] = useState<PropertyRecipe['action'] | ''>('')
  const [dieColor, setDieColor] = useState('#ee927d')
  const [erase, setErase] = useState(false)
  const [painting, setPainting] = useState(false)
  const { game } = runtime
  const definitions = runtime.definitions.value
  const rules = readRules(game.board.tiles, definitions)
  const propertyInstalled = definitions.some((d) => d.id === propertyName)
  const step = (x: number, y: number) => {
    if (busy || open || selected) return
    game.step({ x, y })
    refresh()
  }
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        open ||
        busy ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      )
        return
      const directions: Record<string, [number, number]> = {
        ArrowUp: [0, -1],
        w: [0, -1],
        ArrowDown: [0, 1],
        s: [0, 1],
        ArrowLeft: [-1, 0],
        a: [-1, 0],
        ArrowRight: [1, 0],
        d: [1, 0],
        ' ': [0, 0],
      }
      if (event.key === ' ' && event.target instanceof HTMLButtonElement) return
      if (event.key === 'Escape') {
        setSelected(null)
        return
      }
      if (event.key === 'z') {
        game.undo()
        refresh()
        return
      }
      const direction = directions[event.key]
      if (direction && !selected) {
        event.preventDefault()
        game.step({ x: direction[0], y: direction[1] })
        refresh()
      }
    }
    const release = () => setPainting(false)
    window.addEventListener('keydown', keydown)
    window.addEventListener('pointerup', release)
    return () => {
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('pointerup', release)
    }
  }, [game, open, busy, selected])

  async function publish(definition: Definition) {
    setBusy(true)
    try {
      await runtime.publish(definition)
      setNotice(
        `${definition.id} extension published. The board is still here.`
      )
      refresh()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Publication failed')
    } finally {
      setBusy(false)
    }
  }
  function paint(index: number) {
    setSprite((previous) =>
      previous.map((row, y) =>
        [...row]
          .map((pixel, x) =>
            y * 8 + x === index ? (erase ? '0' : '1') : pixel
          )
          .join('')
      )
    )
  }
  async function reset() {
    setBusy(true)
    try {
      await runtime.loadPuzzle(game.puzzle.id)
      setSelected(null)
      setNotice('Puzzle reset. Authored extensions remain installed.')
      refresh()
    } catch (error) {
      setNotice(String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="./">
          <span className="brand-mark">p.</span> plankton{' '}
          <span className="brand-divider">/</span>{' '}
          <span className="brand-subtitle">a living vocabulary</span>
        </a>
        <span className="sample-tag">
          EXTENSION PLAYGROUND <span className="live-dot" />
        </span>
      </header>
      <main>
        <section className="intro">
          <div>
            <div className="eyebrow">
              WORDS MAKE THE RULES. YOU MAKE THE WORDS.
            </div>
            <h1>
              Plankton <span>is you.</span>
            </h1>
            <p>A tiny world with an editable imagination.</p>
          </div>
          <Dialog.Root
            open={open}
            onOpenChange={(value) => {
              setOpen(value)
              setSelected(null)
            }}
          >
            <Dialog.Trigger asChild>
              <button className="primary editor-trigger">
                <Braces size={18} /> Open runtime editor{' '}
                <ChevronRight size={16} />
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="drawer-overlay" />
              <Dialog.Content
                className="drawer"
                onCloseAutoFocus={(event) => {
                  event.preventDefault()
                  boardRef.current?.focus()
                }}
              >
                <div className="drawer-heading">
                  <div>
                    <div className="eyebrow">THE WORLD, UNDER THE HOOD</div>
                    <Dialog.Title>Runtime editor</Dialog.Title>
                  </div>
                  <Dialog.Close asChild>
                    <button
                      className="icon-button"
                      aria-label="Close runtime editor"
                    >
                      <X />
                    </button>
                  </Dialog.Close>
                </div>
                <Dialog.Description>
                  Play is paused. Every entity and property is an extension;
                  edit the vocabulary, then resume the same world.
                </Dialog.Description>
                <div
                  className="tabs"
                  role="tablist"
                  aria-label="Editor section"
                >
                  {(['sprite', 'behavior', 'extension'] as const).map(
                    (item) => (
                      <button
                        key={item}
                        role="tab"
                        aria-selected={tab === item}
                        onClick={() => setTab(item)}
                      >
                        {item === 'sprite' ? (
                          <Pencil size={15} />
                        ) : item === 'behavior' ? (
                          <Layers size={15} />
                        ) : (
                          <Code2 size={15} />
                        )}
                        {item}
                      </button>
                    )
                  )}
                </div>
                {tab === 'sprite' && (
                  <section className="editor-section">
                    <div className="section-label">ENTITY DEFINITION</div>
                    <h3>Draw something into existence.</h3>
                    <p>
                      Edit BUSH, or give your drawing a new name to create an
                      entity and its noun tile.
                    </p>
                    <label>
                      Entity name
                      <input
                        value={name}
                        maxLength={12}
                        onChange={(e) =>
                          setName(
                            e.target.value.toUpperCase().replace(/[^A-Z]/g, '')
                          )
                        }
                      />
                    </label>
                    <div className="drawing-tools">
                      <label className="color-label">
                        Ink{' '}
                        <input
                          type="color"
                          value={color}
                          onChange={(e) => setColor(e.target.value)}
                        />
                      </label>
                      <button
                        className={erase ? 'active' : ''}
                        onClick={() => setErase(!erase)}
                        aria-pressed={erase}
                      >
                        <Eraser size={15} /> Eraser
                      </button>
                      <button
                        onClick={() => setSprite(Array(8).fill('00000000'))}
                      >
                        Clear
                      </button>
                    </div>
                    <div
                      className="pixel-editor"
                      onPointerCancel={() => setPainting(false)}
                    >
                      {sprite.flatMap((row, y) =>
                        [...row].map((pixel, x) => (
                          <button
                            key={`${x}-${y}`}
                            aria-label={`Pixel ${x + 1}, ${y + 1}`}
                            aria-pressed={pixel === '1'}
                            style={{
                              background: pixel === '1' ? color : undefined,
                            }}
                            onPointerDown={(event) => {
                              event.preventDefault()
                              setPainting(true)
                              paint(y * 8 + x)
                            }}
                            onPointerEnter={(event) => {
                              if (painting && event.buttons === 1)
                                paint(y * 8 + x)
                            }}
                            onClick={(event) => {
                              if (event.detail === 0) paint(y * 8 + x)
                            }}
                          />
                        ))
                      )}
                    </div>
                    <div className="preview-row">
                      <span className="sprite-preview">
                        <SpriteView sprite={sprite} color={color} />
                      </span>
                      <div>
                        <strong>{name || 'UNTITLED'}</strong>
                        <small>8 × 8 pixels · entity + noun</small>
                      </div>
                    </div>
                    <button
                      className="primary wide"
                      disabled={
                        busy ||
                        !name ||
                        definitions.some(
                          (d) => d.id === name && d.kind !== 'entity'
                        )
                      }
                      onClick={() =>
                        publish({
                          kind: 'entity',
                          id: name,
                          color,
                          sprite: [...sprite],
                        })
                      }
                    >
                      <Plus size={16} /> Publish entity extension
                    </button>
                  </section>
                )}
                {tab === 'behavior' && (
                  <section className="editor-section">
                    <div className="section-label">PROPERTY DEFINITION</div>
                    <h3>Give the world a new verb.</h3>
                    <p>
                      The engine has no special case for DIE. This recipe
                      installs a property with a turn effect.
                    </p>
                    <label>
                      Word
                      <input
                        value={propertyName}
                        maxLength={12}
                        onChange={(e) =>
                          setPropertyName(
                            e.target.value.toUpperCase().replace(/[^A-Z]/g, '')
                          )
                        }
                      />
                    </label>
                    <div className="recipe">
                      <div>
                        <span>WHEN</span>
                        <strong>
                          {action === 'block-movement'
                            ? 'Movement is attempted'
                            : 'A turn finishes'}
                        </strong>
                      </div>
                      <div>
                        <span>FOR</span>
                        <strong>
                          Entities described as {propertyName || '…'}
                        </strong>
                      </div>
                      <div>
                        <span>DO</span>
                        <select
                          aria-label="Behavior action"
                          value={action}
                          onChange={(e) => {
                            const value = e.target.value
                            if (
                              value === '' ||
                              value === 'destroy-self' ||
                              value === 'block-movement'
                            )
                              setAction(value)
                          }}
                        >
                          <option value="">Choose an action…</option>
                          <option value="destroy-self">
                            Destroy this entity
                          </option>
                          <option value="block-movement">
                            Block movement into this entity
                          </option>
                        </select>
                      </div>
                    </div>
                    <label className="color-label">
                      Word color
                      <input
                        type="color"
                        value={dieColor}
                        onChange={(e) => setDieColor(e.target.value)}
                      />
                    </label>
                    <div className="hint">
                      <Braces size={18} />
                      <span>
                        Publish, then select the DIE word in the palette and
                        place it in the empty <b>BUSH IS ___</b> sentence. Take
                        a turn to see it work.
                      </span>
                    </div>
                    <button
                      className="primary wide"
                      disabled={
                        busy ||
                        !action ||
                        !propertyName ||
                        definitions.some(
                          (d) => d.id === propertyName && d.kind !== 'property'
                        )
                      }
                      onClick={() => {
                        if (action)
                          void publish(
                            compileProperty({
                              id: propertyName,
                              color: dieColor,
                              action,
                            })
                          )
                      }}
                    >
                      <Plus size={16} />{' '}
                      {propertyInstalled
                        ? `Update ${propertyName} extension`
                        : `Publish ${propertyName || 'property'} extension`}
                    </button>
                  </section>
                )}
                {tab === 'extension' && (
                  <section className="editor-section">
                    <div className="section-label">
                      REAL PLANKTON CONTRIBUTIONS
                    </div>
                    <h3>One mechanism. Every definition.</h3>
                    <p>
                      Built-ins and authored content contribute to the same
                      Facet. Publishing replaces a Slot; the game session
                      survives.
                    </p>
                    <pre>{`contribute(gameContract.definitions, () => ({\n  kind: 'property',\n  id: '${propertyName || 'DIE'}',\n  ${action === 'block-movement' ? 'blocks: true,' : 'afterTurn: (subject, turn) => {\n    turn.destroy(subject.id)\n  },'}\n}), { key: '${propertyName || 'DIE'}' })\n\nawait registry.replace(\n  authoredContent,\n  compileDefinitions(draft, true)\n)`}</pre>
                    <div className="extension-list">
                      {definitions.map((d) => (
                        <div key={d.id}>
                          <span className="live-dot" />
                          <strong>{d.id}</strong>
                          <span>
                            {runtime.registry
                              .debug(gameContract.definitions)
                              .value.find((item) => item.key === d.id)
                              ?.precedence === 'high'
                              ? 'authored'
                              : 'built-in'}{' '}
                            · {d.kind}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="small">
                      Starter puzzles have their own Facet. Each contributes
                      bounds, starting definitions, and placements.
                    </p>
                  </section>
                )}
                <Dialog.Close asChild>
                  <button className="resume-button wide">
                    <ArrowRight size={16} /> Resume play
                  </button>
                </Dialog.Close>
                <div role="status" className="drawer-status">
                  {notice || 'Changes publish without restarting the session.'}
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </section>
        <div className="play-layout">
          <section className="board-panel">
            <div className="board-toolbar">
              <div>
                <span className="level-number">01</span>
                <strong>{game.puzzle.title}</strong>
              </div>
              <div className="board-actions">
                <span>
                  {game.puzzle.bounds.width} × {game.puzzle.bounds.height}
                </span>
                <button
                  className="icon-button"
                  aria-label="Undo turn"
                  disabled={busy}
                  onClick={() => {
                    game.undo()
                    refresh()
                  }}
                >
                  <Undo2 size={17} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Reset puzzle"
                  disabled={busy}
                  onClick={reset}
                >
                  <RotateCcw size={16} />
                </button>
              </div>
            </div>
            <div
              ref={boardRef}
              tabIndex={-1}
              className={`board ${selected ? 'placing' : ''}`}
              style={{
                gridTemplateColumns: `repeat(${game.puzzle.bounds.width}, 1fr)`,
              }}
              aria-label="Puzzle board"
            >
              {Array.from(
                {
                  length: game.puzzle.bounds.width * game.puzzle.bounds.height,
                },
                (_, index) => {
                  const x = index % game.puzzle.bounds.width,
                    y = Math.floor(index / game.puzzle.bounds.width)
                  const tiles = game.board.tiles.filter(
                    (t) => t.x === x && t.y === y
                  )
                  const target = x === 3 && y === 8 && !tiles.length
                  return (
                    <button
                      className={`cell ${target ? 'missing-word' : ''}`}
                      key={index}
                      aria-label={`Column ${x + 1}, row ${y + 1}: ${tiles.map((t) => t.type).join(', ') || 'empty'}`}
                      disabled={busy || open}
                      onClick={() => {
                        if (selected) {
                          game.place({
                            ...selected,
                            x,
                            y,
                            id: crypto.randomUUID(),
                          })
                          setSelected(null)
                          boardRef.current?.focus()
                          refresh()
                        } else if (tiles[0])
                          setNotice(
                            `${tiles[0].type}: ${tiles[0].kind} definition contributed through Plankton. Inspect it in the runtime editor.`
                          )
                      }}
                    >
                      {tiles.map((tile) => {
                        const definition = definitions.find(
                          (d) => d.id === tile.type
                        )
                        const ink =
                          definition && 'color' in definition
                            ? definition.color
                            : '#b7c0c7'
                        return tile.kind === 'word' ? (
                          <span
                            key={tile.id}
                            className="word-tile"
                            style={{ color: ink }}
                          >
                            {tile.type}
                          </span>
                        ) : (
                          <span key={tile.id} className="entity-tile">
                            {definition?.kind === 'entity' ? (
                              <SpriteView
                                sprite={definition.sprite}
                                color={definition.color}
                              />
                            ) : (
                              '?'
                            )}
                          </span>
                        )
                      })}
                      {target && <span className="target-plus">+</span>}
                    </button>
                  )
                }
              )}
            </div>
            <div className="board-footer">
              <span>
                <span className="live-dot" />{' '}
                {game.board.won
                  ? 'Puzzle complete'
                  : open
                    ? 'Editing · play paused'
                    : selected
                      ? `Placing ${selected.type} · play paused`
                      : 'Playing · arrows to move'}
              </span>
              <span>
                {selected && (
                  <button
                    className="cancel-placement"
                    onClick={() => {
                      setSelected(null)
                      boardRef.current?.focus()
                    }}
                  >
                    Resume play
                  </button>
                )}
                {game.board.turns.toString().padStart(2, '0')} turns
              </span>
            </div>
            {game.board.won && (
              <div className="win-banner" role="status">
                <Flag size={22} />
                <div>
                  <strong>Plankton is victorious.</strong>
                  <p>You changed the vocabulary. The world followed.</p>
                </div>
                <button onClick={reset}>Play again</button>
              </div>
            )}
          </section>
          <aside className="sidebar">
            <section className="mission">
              <div className="section-label">
                YOUR FIRST LITTLE IMPOSSIBILITY
              </div>
              <h2>
                Go through.
                <br />
                Not around.
              </h2>
              <p>
                The flag is on the other side. The bushes are STOP. But the
                world’s vocabulary is yours to change.
              </p>
              <ol>
                <li>
                  <span>01</span> Open the runtime editor.
                </li>
                <li>
                  <span>02</span> Author DIE in Behavior.
                </li>
                <li>
                  <span>03</span> Place its word in BUSH IS ___.
                </li>
                <li>
                  <span>04</span> Take a turn. Reach the flag.
                </li>
              </ol>
            </section>
            <section className="rules-card">
              <div className="section-label">
                <Layers size={14} /> LIVE RULES
              </div>
              {rules.map((rule, i) => (
                <div
                  className="rule"
                  key={`${rule.noun}-${rule.property}-${i}`}
                >
                  <span>{rule.noun}</span>
                  <span>IS</span>
                  <strong>{rule.property}</strong>
                </div>
              ))}
              {!rules.some(
                (r) => r.noun === 'BUSH' && r.property === 'DIE'
              ) && (
                <div className="rule pending">
                  <span>BUSH</span>
                  <span>IS</span>
                  <strong>?</strong>
                </div>
              )}
              <p>
                Sentences work across or down.
                <br />
                Word tiles can be pushed.
              </p>
            </section>
          </aside>
        </div>
        <section className="palette-panel">
          <div className="palette-heading">
            <div>
              <div className="section-label">INSTALLED VOCABULARY</div>
              <p>Select a tile, then click a cell to place it.</p>
            </div>
            <span>{definitions.length} definitions</span>
          </div>
          <div className="palette">
            {definitions.flatMap((definition) =>
              (definition.kind === 'entity'
                ? (['entity', 'word'] as const)
                : (['word'] as const)
              ).map((kind) => (
                <button
                  key={`${definition.id}-${kind}`}
                  className={`palette-tile ${selected?.type === definition.id && selected.kind === kind ? 'selected' : ''}`}
                  aria-label={`Place ${definition.id} ${kind}`}
                  aria-pressed={
                    selected?.type === definition.id && selected.kind === kind
                  }
                  disabled={busy}
                  onClick={() =>
                    setSelected(
                      selected?.type === definition.id && selected.kind === kind
                        ? null
                        : { kind, type: definition.id }
                    )
                  }
                >
                  {kind === 'entity' && definition.kind === 'entity' ? (
                    <span className="palette-sprite">
                      <SpriteView
                        sprite={definition.sprite}
                        color={definition.color}
                      />
                    </span>
                  ) : (
                    <span
                      style={{
                        color:
                          'color' in definition ? definition.color : undefined,
                      }}
                    >
                      {definition.id}
                    </span>
                  )}
                  <small>{kind}</small>
                </button>
              ))
            )}
            <button
              className="new-extension"
              onClick={() => {
                setTab('behavior')
                setOpen(true)
                setSelected(null)
              }}
            >
              <Plus size={18} />
              <span>Invent a word</span>
            </button>
          </div>
        </section>
        <footer className="help-footer">
          <div className="key-help">
            <kbd>↑</kbd>
            <kbd>←</kbd>
            <kbd>↓</kbd>
            <kbd>→</kbd>
            <span>move</span>
            <kbd>space</kbd>
            <span>wait</span>
            <kbd>Z</kbd>
            <span>undo</span>
          </div>
          <span>
            Built with <b>Plankton</b> · A world of extensions.
          </span>
        </footer>
        <div className="mobile-controls" aria-label="Movement controls">
          <button aria-label="Move left" onClick={() => step(-1, 0)}>
            <ArrowLeft />
          </button>
          <button aria-label="Move up" onClick={() => step(0, -1)}>
            <ArrowUp />
          </button>
          <button aria-label="Wait a turn" onClick={() => step(0, 0)}>
            Wait
          </button>
          <button aria-label="Move down" onClick={() => step(0, 1)}>
            <ArrowDown />
          </button>
          <button aria-label="Move right" onClick={() => step(1, 0)}>
            <ArrowRight />
          </button>
        </div>
        <div className="notice" role="status">
          {notice && (
            <>
              <Check size={14} />
              {notice}
            </>
          )}
        </div>
      </main>
    </div>
  )
}

const runtime = await openGame()
createRoot(document.getElementById('root')!).render(<App runtime={runtime} />)
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    void runtime.dispose()
  })
