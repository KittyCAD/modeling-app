import { Eraser, Play, Plus, RotateCcw, Trash2, Undo2, X } from 'lucide-react'
import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useHotkeys } from 'react-hotkeys-hook'
import { ActionEditor } from './action-editor'
import { Drawer, IconButton, Select } from './ui'
import { PlanktonDrawer } from './plankton-drawer'
import { TileArt, artwork, ink } from './tile-art'
import { type ActionRecipe, compileAction } from './actions'
import {
  type Definition,
  type Point,
  readRules,
  type Sprite,
  type Tile,
} from './game'
import { OutcomeBoard, type OutcomeCell } from './outcome-board'
import {
  type OutcomeRow,
  startingOutcomeRows,
  parseOutcomeRows,
  resolveOutcomeVocabulary,
} from './outcomes'
import { wordSprite } from './pixels'
import { openGame, type Runtime } from './registry'
import './style.css'

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
const blank = () => Array<string>(8).fill('00000000')

type DraftData = {
  category: Definition['kind']
  artworkKind: Tile['kind']
  name: string
  entitySprite: Sprite
  wordSprite: Sprite
  entityColor: string
  wordColor: string
  action: string
}
type Draft = DraftData &
  (
    | { scope: 'world'; base?: Definition; tileId?: string }
    | { scope: 'outcome'; base?: Definition; cell: OutcomeCell }
  )

function draftFor(
  definition: Definition,
  kind: Tile['kind'],
  tileId?: string
): Draft {
  return {
    scope: 'world',
    base: definition,
    category: definition.kind,
    artworkKind: kind,
    name: definition.id,
    entitySprite: definition.kind === 'entity' ? definition.sprite : blank(),
    wordSprite: artwork(definition, 'word'),
    entityColor: ink(definition, 'entity'),
    wordColor: ink(definition, 'word'),
    action: definition.kind === 'property' ? definition.action : '',
    tileId,
  }
}

function App({ runtime }: { runtime: Runtime }) {
  const { game } = runtime
  const world = useRef<HTMLDivElement>(null)
  const [, render] = useState(0),
    refresh = () => render((n) => n + 1)
  const [open, setOpen] = useState(false),
    [peek, setPeek] = useState(false),
    [busy, setBusy] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [guidePeek, setGuidePeek] = useState(false)
  const [notice, setNotice] = useState('')
  const [outcomeErrors, setOutcomeErrors] = useState<readonly string[]>([])
  const [placement, setPlacement] = useState<{
    type: string
    kind: Tile['kind']
  } | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [outcomeRows, setOutcomeRows] = useState<readonly OutcomeRow[]>(
    runtime.outcomeProgram.value.rows
  )
  const [outcomeHistory, setOutcomeHistory] = useState<
    (readonly OutcomeRow[])[]
  >([])
  const [erase, setErase] = useState(false),
    [painting, setPainting] = useState(false)
  const [actionEditor, setActionEditor] = useState(false)
  const definitions = runtime.definitions.value,
    actions = runtime.actions.value
  const rules = readRules(game.board.tiles, definitions)
  const lossMessage = game.board.status === 'lost' ? game.board.message : ''
  const inspectedTile = game.board.tiles.find(
    (tile) => draft?.scope === 'world' && tile.id === draft.tileId
  )
  const sprite = draft
    ? draft.artworkKind === 'entity'
      ? draft.entitySprite
      : draft.wordSprite
    : []
  const color = draft
    ? draft.artworkKind === 'entity'
      ? draft.entityColor
      : draft.wordColor
    : '#c5ed91'
  const propertyEditable =
    draft?.category === 'property' && draft.artworkKind === 'word'
  const inUse =
    !!draft?.base &&
    (game.board.tiles.some((t) => t.type === draft.name) ||
      runtime.outcomeProgram.value.rows.some((row) =>
        row.cells.includes(draft.name)
      ))

  const outcomeDirty =
    JSON.stringify(outcomeRows) !==
    JSON.stringify(runtime.outcomeProgram.value.rows)
  function editOutcomeRows(rows: readonly OutcomeRow[]) {
    setOutcomeErrors([])
    setOutcomeHistory((previous) => [...previous, outcomeRows])
    setOutcomeRows(rows)
    if (
      draft?.scope === 'outcome' &&
      !rows.some((row) => row.id === draft.cell.rowId)
    )
      setDraft(null)
  }
  function replaceOutcomeCell(cell: OutcomeCell, value: string) {
    editOutcomeRows(
      outcomeRows.map((row) => {
        if (row.id !== cell.rowId) return row
        const cells: [string, string, string, string] = [...row.cells]
        cells[cell.index] = value
        return { ...row, cells }
      })
    )
  }
  function selectOutcome(cell: OutcomeCell, replacement?: string) {
    const id =
      replacement ??
      outcomeRows.find((row) => row.id === cell.rowId)?.cells[cell.index] ??
      ''
    if (replacement !== undefined) replaceOutcomeCell(cell, replacement)
    const definition = definitions.find((word) => word.id === id)
    setDraft(
      definition
        ? {
            ...draftFor(definition, 'word'),
            scope: 'outcome',
            base: definition,
            cell,
          }
        : {
            scope: 'outcome',
            cell,
            category: 'word',
            artworkKind: 'word',
            name: '',
            entitySprite: blank(),
            wordSprite: wordSprite(''),
            entityColor: '#c5ed91',
            wordColor: '#c5ed91',
            action: '',
          }
    )
    setActionEditor(false)
    setNotice('')
  }
  function selectOutcomeTiles(cell: OutcomeCell, wordTiles: boolean) {
    if (cell.index !== 0 && cell.index !== 2) return
    const index = cell.index
    editOutcomeRows(
      outcomeRows.map((row) => {
        if (row.id !== cell.rowId) return row
        const selections = (row.wordTiles ?? []).filter(
          (position) => position !== index
        )
        if (wordTiles) selections.push(index)
        return { ...row, wordTiles: selections.length ? selections : undefined }
      })
    )
  }
  async function applyOutcomes() {
    setNotice('')
    setOutcomeErrors([])
    const parsed = parseOutcomeRows(
      outcomeRows,
      resolveOutcomeVocabulary(definitions, runtime.outcomeMeanings.value)
    )
    if (!parsed.ok) {
      setOutcomeErrors(parsed.errors)
      return
    }
    if (
      await change(
        () => runtime.publishOutcomeRows(outcomeRows),
        'Outcome program applied',
        (message) => setOutcomeErrors([message])
      )
    ) {
      game.settle()
      refresh()
    }
  }

  function select(definition: Definition, kind: Tile['kind'], tileId?: string) {
    if (
      !tileId &&
      draft?.base?.id === definition.id &&
      draft.artworkKind === kind
    ) {
      setDraft(null)
      return
    }
    if (draft?.scope === 'outcome' && kind === 'word' && !tileId) {
      selectOutcome(draft.cell, definition.id)
      return
    }
    setDraft(draftFor(definition, kind, tileId))
    setActionEditor(false)
    setErase(false)
    setNotice('')
  }
  function create() {
    setDraft({
      scope: 'world',
      category: 'entity',
      artworkKind: 'entity',
      name: '',
      entitySprite: blank(),
      wordSprite: wordSprite(''),
      entityColor: '#c5ed91',
      wordColor: '#c5ed91',
      action: '',
    })
    setActionEditor(false)
    setNotice('')
  }
  function undo() {
    game.undo()
    setNotice('Undone')
    refresh()
  }
  function resume() {
    game.settle()
    refresh()
    setPlacement(null)
    setOpen(false)
    setPeek(false)
    world.current?.focus()
  }
  function step(direction: Point) {
    if (open || guideOpen || busy || placement) return
    game.step(direction)
    refresh()
  }
  useHotkeys(
    'up,w,down,s,left,a,right,d,space,z,escape',
    (event) => {
      if (event.key === 'Escape') {
        setPlacement(null)
        return
      }
      if (placement) return
      if (event.key === 'z') undo()
      else {
        const direction = directions[event.key]
        if (direction) {
          game.step(direction)
          refresh()
        }
      }
    },
    { enabled: !open && !guideOpen && !busy, preventDefault: true },
    [game, placement]
  )
  useEffect(() => {
    const release = () => setPainting(false)
    const proximity = (event: PointerEvent) => {
      setPeek(event.clientX > window.innerWidth - 64)
      setGuidePeek(event.clientX < 64)
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointermove', proximity)
    return () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointermove', proximity)
    }
  }, [])
  async function change(
    work: () => Promise<void>,
    message: string,
    onError: (message: string) => void = setNotice
  ) {
    setBusy(true)
    try {
      await work()
      setNotice(message)
      refresh()
      return true
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
      return false
    } finally {
      setBusy(false)
    }
  }
  async function save() {
    if (!draft) return
    const word = { wordSprite: draft.wordSprite, wordColor: draft.wordColor }
    let definition: Definition
    switch (draft.category) {
      case 'grammar':
        definition = { kind: 'grammar', id: 'IS', ...word }
        break
      case 'word':
        definition = {
          kind: 'word',
          id: draft.name,
          color: draft.entityColor,
          ...word,
        }
        break
      case 'entity':
        definition = {
          kind: 'entity',
          id: draft.name,
          color: draft.entityColor,
          sprite: draft.entitySprite,
          ...word,
        }
        break
      case 'property':
        definition = {
          kind: 'property',
          id: draft.name,
          color: draft.wordColor,
          action: draft.action,
          ...word,
        }
        break
    }
    if (
      await change(
        () => runtime.publish(definition),
        `${definition.id} published`
      )
    )
      setDraft(
        draft.scope === 'outcome'
          ? {
              ...draftFor(definition, 'word'),
              scope: 'outcome',
              base: definition,
              cell: draft.cell,
            }
          : draftFor(definition, draft.artworkKind, draft.tileId)
      )
  }
  async function saveAction(recipe: ActionRecipe) {
    const action = compileAction(recipe)
    if (
      await change(
        () => runtime.publishAction(action),
        `${action.id} action installed`
      )
    ) {
      setDraft((previous) =>
        previous ? { ...previous, action: action.id } : previous
      )
      setActionEditor(false)
    }
  }
  function paint(index: number) {
    setDraft((previous) => {
      if (!previous) return previous
      const key =
        previous.artworkKind === 'entity' ? 'entitySprite' : 'wordSprite'
      return {
        ...previous,
        [key]: previous[key].map((row, y) =>
          [...row]
            .map((pixel, x) =>
              y * row.length + x === index ? (erase ? '0' : '1') : pixel
            )
            .join('')
        ),
      }
    })
  }
  function boardClick(x: number, y: number) {
    if (busy) return
    if (placement) {
      game.place({ ...placement, x, y, id: crypto.randomUUID() })
      setPlacement(null)
      world.current?.focus()
      refresh()
    } else {
      const tile = game.board.tiles.find((t) => t.x === x && t.y === y),
        definition = definitions.find((d) => d.id === tile?.type)
      if (tile && definition) select(definition, tile.kind, tile.id)
      else
        setDraft((previous) =>
          previous ? { ...previous, tileId: undefined } : null
        )
      setOpen(true)
    }
  }
  async function reset() {
    if (await change(() => runtime.loadPuzzle(game.puzzle.id), 'Puzzle reset'))
      setPlacement(null)
  }
  const duplicate =
    !!draft && !draft.base && definitions.some((d) => d.id === draft.name)
  const canSave =
    !!draft &&
    !!draft.name &&
    !duplicate &&
    (draft.category !== 'property' ||
      actions.some((a) => a.id === draft.action))

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
              y = Math.floor(index / game.puzzle.bounds.width),
              tiles = game.board.tiles.filter((t) => t.x === x && t.y === y)
            return (
              <button
                key={index}
                className="cell"
                disabled={busy || open || guideOpen}
                aria-label={`Column ${x + 1}, row ${y + 1}: ${tiles.map((t) => t.type).join(', ') || 'empty'}`}
                onClick={() => boardClick(x, y)}
              >
                {tiles.map((tile) => {
                  const definition = definitions.find((d) => d.id === tile.type)
                  return (
                    <span key={tile.id} className={`tile ${tile.kind}`}>
                      {definition ? (
                        <TileArt definition={definition} kind={tile.kind} />
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
        {(game.board.status === 'won' || game.board.status === 'lost') && (
          <div
            className={`victory ${game.board.status === 'lost' ? 'loss' : ''}`}
            role="status"
          >
            <span>{game.board.status === 'lost' ? lossMessage : 'WIN'}</span>
            {game.board.status === 'lost' && (
              <button onClick={undo} aria-label="Undo loss">
                <Undo2 size={22} />
              </button>
            )}
            <button onClick={reset} aria-label="Play again">
              <RotateCcw size={22} />
            </button>
          </div>
        )}
      </div>
      <PlanktonDrawer
        runtime={runtime}
        open={guideOpen}
        peek={guidePeek}
        onOpenChange={(value) => {
          setGuideOpen(value)
          setGuidePeek(false)
        }}
        onEdit={(definition, kind) => {
          setDraft(draftFor(definition, kind))
          setActionEditor(false)
          setErase(false)
          setNotice('')
          setGuideOpen(false)
          setOpen(true)
        }}
      />
      <Drawer
        side="right"
        title="Editor"
        label="Open editor"
        description={`Paused · ${game.puzzle.title}`}
        open={open}
        peek={peek}
        onOpenChange={(value) => {
          if (!value) {
            game.settle()
            refresh()
          }
          setOpen(value)
          setPeek(false)
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          world.current?.focus()
        }}
        actions={
          <>
            <IconButton
              icon={Undo2}
              label="Undo"
              disabled={busy}
              onClick={undo}
            />
            <IconButton
              icon={RotateCcw}
              label="Reset puzzle"
              disabled={busy}
              onClick={reset}
            />
            <IconButton icon={Play} label="Resume play" onClick={resume} />
          </>
        }
        details={
          draft && (
            <section className="tray" aria-label="Vocabulary details">
              <div className="details-heading">
                <h2>Vocabulary details</h2>
                <IconButton
                  icon={X}
                  label="Close vocabulary details"
                  onClick={() => setDraft(null)}
                />
              </div>
              <div className="tray-heading">
                <h2>
                  {draft.scope === 'outcome'
                    ? `Outcome · ${draft.name || 'empty'}`
                    : draft.base
                      ? draft.name
                      : 'New'}
                </h2>
                <div className="kind-toggle" aria-label="Tile kind">
                  {(['entity', 'word'] as const).map((kind) => (
                    <button
                      key={kind}
                      aria-pressed={draft.artworkKind === kind}
                      disabled={
                        busy ||
                        (kind === 'entity' &&
                          (draft.scope === 'outcome' ||
                            (draft.base && draft.category !== 'entity')))
                      }
                      onClick={() =>
                        setDraft({
                          ...draft,
                          artworkKind: kind,
                          category:
                            draft.base || draft.scope === 'outcome'
                              ? draft.category
                              : kind === 'entity'
                                ? 'entity'
                                : 'property',
                        })
                      }
                    >
                      {kind}
                    </button>
                  ))}
                </div>
              </div>
              {draft.scope === 'outcome' && (
                <button
                  className="text-button"
                  onClick={() => {
                    if (draft.base) setDraft(draftFor(draft.base, 'word'))
                    else setDraft(null)
                  }}
                >
                  Done editing cell
                </button>
              )}
              <label>
                Name
                <input
                  value={draft.name}
                  readOnly={!!draft.base || draft.scope === 'outcome'}
                  maxLength={8}
                  onChange={(event) => {
                    const name = event.target.value
                      .toUpperCase()
                      .replace(/[^A-Z]/g, '')
                    setDraft({
                      ...draft,
                      name,
                      wordSprite: wordSprite(name),
                    })
                  }}
                />
              </label>
              {duplicate && (
                <p className="field-hint">
                  That name is already installed. Select its tile to edit it.
                </p>
              )}
              {draft.scope === 'outcome' && (
                <Select
                  label="Outcome tile"
                  value={draft.base?.id ?? ''}
                  disabled={busy}
                  options={[
                    ['', '_'],
                    ...definitions.map(
                      (definition) => [definition.id, definition.id] as const
                    ),
                  ]}
                  onChange={(value) => selectOutcome(draft.cell, value)}
                />
              )}
              {draft.scope === 'outcome' &&
                (draft.cell.index === 0 || draft.cell.index === 2) && (
                  <>
                    <Select
                      label="Outcome selection"
                      value={
                        outcomeRows
                          .find((row) => row.id === draft.cell.rowId)
                          ?.wordTiles?.includes(draft.cell.index)
                          ? 'word'
                          : 'default'
                      }
                      options={[
                        ['default', 'Default meaning'],
                        ['word', 'Word tiles'],
                      ]}
                      disabled={busy}
                      onChange={(value) =>
                        selectOutcomeTiles(draft.cell, value === 'word')
                      }
                    />
                    <p className="field-hint">
                      Word tiles selects the physical word, rather than entities
                      described by it.
                    </p>
                  </>
                )}
              <Select
                label="Property action"
                disabled={!propertyEditable || busy || !draft.name}
                value={propertyEditable ? draft.action : ''}
                options={[
                  [
                    '',
                    {
                      entity: 'None · entity name',
                      grammar: 'Sentence connector',
                      word: 'Outcome predicate',
                      property: 'Choose an action…',
                    }[draft.category],
                  ],
                  ...actions.map(
                    (action) => [action.id, action.label] as const
                  ),
                ]}
                onChange={(action) => setDraft({ ...draft, action })}
              />
              {runtime.outcomeMeanings.value.find(
                (meaning) => meaning.id === draft.name
              )?.description && (
                <p className="field-hint">
                  {
                    runtime.outcomeMeanings.value.find(
                      (meaning) => meaning.id === draft.name
                    )?.description
                  }
                </p>
              )}
              <div className="paint-tools">
                <label>
                  Ink
                  <input
                    type="color"
                    value={color}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        [draft.artworkKind === 'entity'
                          ? 'entityColor'
                          : 'wordColor']: event.target.value,
                      })
                    }
                  />
                </label>
                <button aria-pressed={erase} onClick={() => setErase(!erase)}>
                  <Eraser size={15} />
                  Erase
                </button>
                <button
                  onClick={() =>
                    setDraft({
                      ...draft,
                      [draft.artworkKind === 'entity'
                        ? 'entitySprite'
                        : 'wordSprite']: sprite.map((row) =>
                        '0'.repeat(row.length)
                      ),
                    })
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
              {draft.scope === 'world' && propertyEditable && (
                <>
                  <p className="field-hint">
                    {actions.find((a) => a.id === draft.action)?.description ||
                      'A property word applies its action through an IS sentence.'}
                  </p>
                  <button
                    className="text-button"
                    onClick={() => setActionEditor(!actionEditor)}
                  >
                    {actionEditor ? 'Cancel new action' : '+ New action'}
                  </button>
                  {actionEditor && (
                    <ActionEditor
                      name={draft.name}
                      properties={definitions.filter(
                        (
                          definition
                        ): definition is import('./game').PropertyDefinition =>
                          definition.kind === 'property'
                      )}
                      busy={busy}
                      onInstall={saveAction}
                    />
                  )}
                </>
              )}
              <div className="tray-actions">
                <button
                  className="publish"
                  disabled={busy || !canSave}
                  onClick={save}
                >
                  {draft.base ? 'Save definition' : 'Create definition'}
                </button>
                {draft.scope === 'world' && (
                  <button
                    disabled={busy || !draft.base}
                    onClick={() => {
                      if (!draft.base) return
                      setPlacement({
                        type: draft.base.id,
                        kind: draft.artworkKind,
                      })
                      setDraft({ ...draft, tileId: undefined })
                      setOpen(false)
                    }}
                  >
                    Place tile
                  </button>
                )}
              </div>
              <div className="delete-actions">
                {draft.scope === 'outcome' && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      replaceOutcomeCell(draft.cell, '')
                      setDraft(null)
                    }}
                  >
                    <Trash2 size={13} />
                    Remove outcome tile
                  </button>
                )}
                {inspectedTile && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      game.remove(inspectedTile.id)
                      setNotice(
                        `${inspectedTile.type} removed · Undo restores it`
                      )
                      refresh()
                    }}
                  >
                    <Trash2 size={13} />
                    Remove tile
                  </button>
                )}
                {draft.base && (
                  <button
                    disabled={busy || inUse}
                    title={
                      inUse
                        ? 'Remove placed tiles and applied outcome references before deleting their definition'
                        : undefined
                    }
                    onClick={async () => {
                      if (
                        await change(
                          () => runtime.deleteDefinition(draft.base!.id),
                          `${draft.name} definition deleted`
                        )
                      )
                        setDraft(null)
                    }}
                  >
                    <Trash2 size={13} />
                    Delete definition
                  </button>
                )}
              </div>
              {inUse && (
                <p className="field-hint">
                  Delete definition becomes available after its placed tiles and
                  applied outcome references are removed.
                </p>
              )}
            </section>
          )
        }
      >
        <section className="rules">
          <h2>Live rules</h2>
          <ul>
            {rules.map((rule, index) => (
              <li
                key={`${rule.noun}-${rule.property}-${index}`}
                aria-label={`${rule.noun} IS ${rule.property}`}
              >
                {[rule.noun, 'IS', rule.property].map((id, i) => {
                  const definition = definitions.find((d) => d.id === id)
                  return definition ? (
                    <span key={`${id}-${i}`}>
                      <TileArt definition={definition} kind={'word'} />
                    </span>
                  ) : null
                })}
              </li>
            ))}
          </ul>
          {rules.length === 0 && <p>No active sentences.</p>}
        </section>
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
                    draft?.base?.id === definition.id &&
                    draft.artworkKind === kind
                  }
                  disabled={busy}
                  onClick={() => select(definition, kind)}
                >
                  <TileArt definition={definition} kind={kind} />
                  <small>{kind}</small>
                </button>
              ))
            )}
            <button
              className="new-item"
              aria-label="New vocabulary item"
              aria-pressed={!!draft && !draft.base}
              onClick={create}
            >
              <Plus size={22} />
              <small>New</small>
            </button>
          </div>
        </section>
        <OutcomeBoard
          rows={outcomeRows}
          errors={outcomeErrors}
          words={definitions}
          busy={busy}
          dirty={outcomeDirty}
          canUndo={outcomeHistory.length > 0}
          renderWord={(word) => <TileArt definition={word} />}
          selected={draft?.scope === 'outcome' ? draft.cell : undefined}
          onSelect={(cell) => selectOutcome(cell)}
          onChange={editOutcomeRows}
          onApply={applyOutcomes}
          onUndo={() => {
            const previous = outcomeHistory.at(-1)
            if (previous) {
              setOutcomeErrors([])
              setOutcomeRows(previous)
              setOutcomeHistory(outcomeHistory.slice(0, -1))
              setDraft(null)
            }
          }}
          onRestore={() => editOutcomeRows(startingOutcomeRows)}
        />
        <footer>
          <p role="status">{notice}</p>
          <small>
            Arrows / WASD · Space waits · Z undoes
            <br />
            Place tile pauses until placement or Esc.
          </small>
          <button className="resume" onClick={resume}>
            <Play size={14} />
            Resume play
          </button>
        </footer>
      </Drawer>
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
