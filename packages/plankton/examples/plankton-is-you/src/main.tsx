import * as Dialog from '@radix-ui/react-dialog'
import { ChevronLeft, Eraser, Play, RotateCcw, Undo2 } from 'lucide-react'
import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { compileProperty, type PropertyRecipe } from './content'
import {
  type Definition,
  type Point,
  readRules,
  type Sprite,
  type Tile,
} from './game'
import { wordSprite } from './pixels'
import { gameContract, openGame, type Runtime } from './registry'
import './style.css'

function Pixels({ sprite, color }: { sprite: Sprite; color: string }) {
  return (
    <svg
      viewBox={`0 0 ${sprite[0].length} ${sprite.length}`}
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
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
const ink = (definition: Definition, kind: Tile['kind']) =>
  kind === 'word' && definition.wordColor
    ? definition.wordColor
    : 'color' in definition
      ? definition.color
      : '#ded9cf'
const drawing = (definition: Definition, kind: Tile['kind']) =>
  kind === 'entity' && definition.kind === 'entity'
    ? definition.sprite
    : (definition.wordSprite ?? wordSprite(definition.id))
type Selection = { definition: Definition; kind: Tile['kind'] }

function App({ runtime }: { runtime: Runtime }) {
  const { game } = runtime
  const world = useRef<HTMLDivElement>(null)
  const [, render] = useState(0)
  const refresh = () => render((n) => n + 1)
  const [open, setOpen] = useState(false)
  const [peek, setPeek] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [placement, setPlacement] = useState<{
    type: string
    kind: Tile['kind']
  } | null>(null)
  const definitions = runtime.definitions.value
  const rules = readRules(game.board.tiles, definitions)
  const [selection, setSelection] = useState<Selection>({
    definition: definitions.find((d) => d.id === 'BUSH')!,
    kind: 'entity',
  })
  const [sprite, setSprite] = useState<Sprite>(() =>
    drawing(selection.definition, selection.kind)
  )
  const [color, setColor] = useState(ink(selection.definition, selection.kind))
  const [name, setName] = useState(selection.definition.id)
  const [erase, setErase] = useState(false)
  const [painting, setPainting] = useState(false)
  const [tab, setTab] = useState<'pixels' | 'behavior' | 'extensions'>('pixels')
  const [propertyName, setPropertyName] = useState('DIE')
  const [action, setAction] = useState<PropertyRecipe['action'] | ''>('')
  const [propertyColor, setPropertyColor] = useState('#ee927d')

  function select(definition: Definition, kind: Tile['kind']) {
    setSelection({ definition, kind })
    setName(definition.id)
    setSprite(drawing(definition, kind))
    setColor(ink(definition, kind))
    setTab('pixels')
  }
  function resume() {
    setPlacement(null)
    setOpen(false)
    setPeek(false)
    world.current?.focus()
  }
  function step(direction: Point) {
    if (open || busy || placement) return
    game.step(direction)
    refresh()
  }
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        open ||
        busy ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement
      )
        return
      if (event.key === 'Escape') {
        setPlacement(null)
        return
      }
      if (placement) return
      const directions: Record<string, Point> = {
        ArrowUp: { x: 0, y: -1 },
        w: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 },
        s: { x: 0, y: 1 },
        ArrowLeft: { x: -1, y: 0 },
        a: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
        d: { x: 1, y: 0 },
        ' ': { x: 0, y: 0 },
      }
      if (event.key === 'z') {
        game.undo()
        refresh()
      } else if (directions[event.key]) {
        event.preventDefault()
        game.step(directions[event.key])
        refresh()
      }
    }
    const release = () => setPainting(false)
    const proximity = (event: PointerEvent) =>
      setPeek(event.clientX > window.innerWidth - 64)
    window.addEventListener('keydown', keydown)
    window.addEventListener('pointerup', release)
    window.addEventListener('pointermove', proximity)
    return () => {
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointermove', proximity)
    }
  }, [game, open, busy, placement])

  async function publish(definition: Definition) {
    setBusy(true)
    try {
      await runtime.publish(definition)
      setNotice(`${definition.id} published`)
      refresh()
      return true
    } catch (error) {
      setNotice(String(error))
      return false
    } finally {
      setBusy(false)
    }
  }
  async function publishPixels() {
    const current = definitions.find((d) => d.id === name)
    let definition: Definition
    if (selection.kind === 'entity') {
      if (current && current.kind !== 'entity') return
      definition = {
        kind: 'entity',
        id: name,
        color,
        sprite: [...sprite],
        wordSprite: current?.wordSprite,
        wordColor: current?.wordColor,
      }
    } else {
      if (!current) return
      definition = { ...current, wordSprite: [...sprite], wordColor: color }
    }
    if (await publish(definition)) select(definition, selection.kind)
  }
  function paint(index: number) {
    setSprite((previous) =>
      previous.map((row, y) =>
        [...row]
          .map((pixel, x) =>
            y * row.length + x === index ? (erase ? '0' : '1') : pixel
          )
          .join('')
      )
    )
  }
  function boardClick(x: number, y: number) {
    if (busy) return
    if (placement) {
      game.place({ ...placement, x, y, id: crypto.randomUUID() })
      setPlacement(null)
      world.current?.focus()
      refresh()
    } else {
      const tile = game.board.tiles.find((t) => t.x === x && t.y === y)
      const definition = definitions.find((d) => d.id === tile?.type)
      if (tile && definition) select(definition, tile.kind)
      setOpen(true)
    }
  }
  async function reset() {
    setBusy(true)
    try {
      await runtime.loadPuzzle(game.puzzle.id)
      setPlacement(null)
      setNotice('Puzzle reset')
      refresh()
    } catch (error) {
      setNotice(String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="stage">
      <div
        ref={world}
        tabIndex={-1}
        className={`world ${placement ? 'placing' : ''}`}
        style={
          {
            '--columns': game.puzzle.bounds.width,
            '--rows': game.puzzle.bounds.height,
            '--ratio': game.puzzle.bounds.width / game.puzzle.bounds.height,
          } as CSSProperties
        }
        aria-label="Puzzle board"
      >
        {Array.from(
          { length: game.puzzle.bounds.width * game.puzzle.bounds.height },
          (_, index) => {
            const x = index % game.puzzle.bounds.width,
              y = Math.floor(index / game.puzzle.bounds.width)
            const tiles = game.board.tiles.filter((t) => t.x === x && t.y === y)
            return (
              <button
                key={index}
                className="cell"
                disabled={busy || open}
                aria-label={`Column ${x + 1}, row ${y + 1}: ${tiles.map((t) => t.type).join(', ') || 'empty'}`}
                onClick={() => boardClick(x, y)}
              >
                {tiles.map((tile) => {
                  const definition = definitions.find((d) => d.id === tile.type)
                  return (
                    <span key={tile.id} className={`tile ${tile.kind}`}>
                      {definition ? (
                        <Pixels
                          sprite={drawing(definition, tile.kind)}
                          color={ink(definition, tile.kind)}
                        />
                      ) : (
                        '?'
                      )}
                    </span>
                  )
                })}
              </button>
            )
          }
        )}
        {game.board.won && (
          <div className="victory" role="status">
            <span>WIN</span>
            <button onClick={reset} aria-label="Play again">
              <RotateCcw size={22} />
            </button>
          </div>
        )}
      </div>
      <Dialog.Root
        open={open}
        onOpenChange={(value) => {
          setOpen(value)
          setPeek(false)
        }}
      >
        <Dialog.Trigger asChild>
          <button
            className={`editor-edge ${peek ? 'peek' : ''}`}
            aria-label="Open editor"
            title="Editor"
          >
            <ChevronLeft size={18} />
            <span>Editor</span>
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="editor-overlay" />
          <Dialog.Content
            className="editor"
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              world.current?.focus()
            }}
          >
            <header>
              <Dialog.Title>Editor</Dialog.Title>
              <div className="editor-actions">
                <button
                  aria-label="Undo"
                  title="Undo"
                  disabled={busy}
                  onClick={() => {
                    game.undo()
                    refresh()
                  }}
                >
                  <Undo2 size={17} />
                </button>
                <button
                  aria-label="Reset puzzle"
                  title="Reset"
                  disabled={busy}
                  onClick={reset}
                >
                  <RotateCcw size={16} />
                </button>
                <Dialog.Close asChild>
                  <button
                    aria-label="Resume play"
                    title="Resume play"
                    onClick={() => setPlacement(null)}
                  >
                    <Play size={17} />
                  </button>
                </Dialog.Close>
              </div>
            </header>
            <Dialog.Description className="editor-description">
              Paused · {game.puzzle.title}
            </Dialog.Description>
            <section>
              <h2>Installed vocabulary</h2>
              <div className="vocabulary">
                {definitions.flatMap((definition) =>
                  (definition.kind === 'entity'
                    ? (['entity', 'word'] as const)
                    : (['word'] as const)
                  ).map((kind) => (
                    <button
                      key={`${definition.id}-${kind}`}
                      aria-label={`Edit ${definition.id} ${kind}`}
                      aria-pressed={
                        selection.definition.id === definition.id &&
                        selection.kind === kind
                      }
                      onClick={() => select(definition, kind)}
                    >
                      <Pixels
                        sprite={drawing(definition, kind)}
                        color={ink(definition, kind)}
                      />
                      <small>{kind}</small>
                    </button>
                  ))
                )}
              </div>
            </section>
            <section className="rules">
              <h2>Live rules</h2>
              <div>
                {rules.map((rule, index) => (
                  <span key={`${rule.noun}-${rule.property}-${index}`}>
                    {rule.noun} IS {rule.property}
                  </span>
                ))}
              </div>
            </section>
            <nav aria-label="Definition editor">
              {(['pixels', 'behavior', 'extensions'] as const).map((item) => (
                <button
                  key={item}
                  aria-pressed={tab === item}
                  onClick={() => setTab(item)}
                >
                  {item === 'behavior'
                    ? 'New property'
                    : item === 'extensions'
                      ? 'Extensions'
                      : 'Pixels'}
                </button>
              ))}
            </nav>
            {tab === 'pixels' && (
              <section className="pixel-section">
                <div className="selection-heading">
                  <h2>
                    {selection.definition.id} · {selection.kind}
                  </h2>
                  <button
                    className="place-button"
                    disabled={busy}
                    onClick={() => {
                      setPlacement({
                        type: selection.definition.id,
                        kind: selection.kind,
                      })
                      setOpen(false)
                    }}
                  >
                    Place tile
                  </button>
                </div>
                <label>
                  Name
                  <input
                    value={name}
                    readOnly={selection.kind === 'word'}
                    maxLength={8}
                    onChange={(event) =>
                      setName(
                        event.target.value.toUpperCase().replace(/[^A-Z]/g, '')
                      )
                    }
                  />
                </label>
                <div className="paint-tools">
                  <label>
                    Ink
                    <input
                      type="color"
                      value={color}
                      onChange={(event) => setColor(event.target.value)}
                    />
                  </label>
                  <button aria-pressed={erase} onClick={() => setErase(!erase)}>
                    <Eraser size={15} />
                    Erase
                  </button>
                  <button
                    onClick={() =>
                      setSprite(sprite.map((row) => '0'.repeat(row.length)))
                    }
                  >
                    Clear
                  </button>
                </div>
                <div
                  className="pixel-editor"
                  style={{
                    gridTemplateColumns: `repeat(${sprite[0].length},1fr)`,
                  }}
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
                          paint(y * row.length + x)
                        }}
                        onPointerEnter={(event) => {
                          if (painting && event.buttons === 1)
                            paint(y * row.length + x)
                        }}
                        onClick={(event) => {
                          if (event.detail === 0) paint(y * row.length + x)
                        }}
                      />
                    ))
                  )}
                </div>
                <button
                  className="publish"
                  disabled={
                    busy ||
                    !name ||
                    (selection.kind === 'entity' &&
                      definitions.some(
                        (d) => d.id === name && d.kind !== 'entity'
                      ))
                  }
                  onClick={publishPixels}
                >
                  Publish pixels
                </button>
              </section>
            )}
            {tab === 'behavior' && (
              <section>
                <label>
                  Word
                  <input
                    value={propertyName}
                    maxLength={8}
                    onChange={(event) =>
                      setPropertyName(
                        event.target.value.toUpperCase().replace(/[^A-Z]/g, '')
                      )
                    }
                  />
                </label>
                <label>
                  Action
                  <select
                    aria-label="Action"
                    value={action}
                    onChange={(event) => {
                      const value = event.target.value
                      if (
                        value === '' ||
                        value === 'destroy-self' ||
                        value === 'block-movement'
                      )
                        setAction(value)
                    }}
                  >
                    <option value="">Choose…</option>
                    <option value="destroy-self">
                      At turn end: destroy this entity
                    </option>
                    <option value="block-movement">
                      Block movement into this entity
                    </option>
                  </select>
                </label>
                <label className="color-field">
                  Ink
                  <input
                    type="color"
                    value={propertyColor}
                    onChange={(event) => setPropertyColor(event.target.value)}
                  />
                </label>
                <button
                  className="publish"
                  disabled={
                    busy ||
                    !action ||
                    !propertyName ||
                    definitions.some(
                      (d) => d.id === propertyName && d.kind !== 'property'
                    )
                  }
                  onClick={async () => {
                    if (!action) return
                    const previous = definitions.find(
                      (d) => d.id === propertyName
                    )
                    const definition = {
                      ...compileProperty({
                        id: propertyName,
                        color: propertyColor,
                        action,
                      }),
                      wordSprite:
                        previous?.wordSprite ?? wordSprite(propertyName),
                      wordColor: previous?.wordColor,
                    }
                    if (await publish(definition)) select(definition, 'word')
                  }}
                >
                  Publish property
                </button>
              </section>
            )}
            {tab === 'extensions' && (
              <section className="extensions">
                <pre>{`contribute(gameContract.definitions,\n  () => definition,\n  { key: definition.id }\n)\n\nawait registry.replace(\n  authoredContent,\n  compileDefinitions(draft, true)\n)`}</pre>
                {definitions.map((definition) => (
                  <div key={definition.id}>
                    <span>{definition.id}</span>
                    <small>
                      {runtime.registry
                        .debug(gameContract.definitions)
                        .value.find((item) => item.key === definition.id)
                        ?.precedence === 'high'
                        ? 'authored'
                        : 'built-in'}
                    </small>
                  </div>
                ))}
              </section>
            )}
            <footer>
              <p role="status">{notice}</p>
              <small>
                Arrows / WASD · Space waits · Z undoes
                <br />
                Place tile pauses play until placement or Esc.
              </small>
              <button className="resume" onClick={resume}>
                <Play size={14} /> Resume play
              </button>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <div className="touch-controls" aria-label="Movement controls">
        {[
          { x: -1, y: 0, label: 'Left' },
          { x: 0, y: -1, label: 'Up' },
          { x: 0, y: 0, label: 'Wait' },
          { x: 0, y: 1, label: 'Down' },
          { x: 1, y: 0, label: 'Right' },
        ].map((direction) => (
          <button key={direction.label} onClick={() => step(direction)}>
            {direction.label}
          </button>
        ))}
      </div>
    </main>
  )
}
const runtime = await openGame()
createRoot(document.getElementById('root')!).render(<App runtime={runtime} />)
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    void runtime.dispose()
  })
