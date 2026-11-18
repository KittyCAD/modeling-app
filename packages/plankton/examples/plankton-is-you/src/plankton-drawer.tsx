import * as Dialog from '@radix-ui/react-dialog'
import { ArrowDown, ChevronRight, X } from 'lucide-react'
import { useRef, useState } from 'react'
import type { Definition, Sprite, Tile } from './game'
import { gameContract, type Runtime } from './registry'
import { Pixels, artwork, ink } from './tile-art'

/** An actual definition replacement, viewed from its editor through to its consumer. */
export function PlanktonDrawer({
  runtime,
  open,
  peek,
  busy,
  onOpenChange,
  onEdit,
  onPublish,
}: {
  runtime: Runtime
  open: boolean
  peek: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onEdit: (definition: Definition, kind: Tile['kind']) => void
  onPublish: (definition: Definition) => Promise<boolean>
}) {
  const session = useRef(runtime.registry.required(gameContract.session))
  const [selected, setSelected] = useState('BUSH')
  const [kind, setKind] = useState<Tile['kind']>('entity')
  const [pixels, setPixels] = useState<Sprite | null>(null)
  const [before, setBefore] = useState<Definition | null>(null)
  const [error, setError] = useState('')
  const definitions = runtime.definitions.value
  const definition =
    definitions.find((item) => item.id === selected) ?? definitions[0]
  const tileKind = definition?.kind === 'entity' ? kind : 'word'
  const installed = definition ? artwork(definition, tileKind) : []
  const draft = pixels ?? installed
  const dirty = JSON.stringify(draft) !== JSON.stringify(installed)
  const sameSession =
    session.current === runtime.registry.required(gameContract.session)
  const { bounds } = runtime.game.puzzle
  const picture = (item: Definition, type: Tile['kind'] = tileKind) => (
    <span className="trace-tile" role="img" aria-label={`${item.id} ${type}`}>
      <Pixels sprite={artwork(item, type)} color={ink(item, type)} />
    </span>
  )
  function choose(item: Definition) {
    setSelected(item.id)
    setKind(item.kind === 'entity' ? 'entity' : 'word')
    setPixels(null)
    setBefore(null)
    setError('')
  }
  async function apply() {
    if (!definition) return
    const replacement: Definition =
      definition.kind === 'entity' && tileKind === 'entity'
        ? { ...definition, sprite: draft }
        : { ...definition, wordSprite: draft }
    if (await onPublish(replacement)) {
      setBefore(before ?? definition)
      setPixels(null)
      setError('')
    } else setError('The edit could not be installed. Try again.')
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (value) {
          setPixels(null)
          setBefore(null)
          setError('')
        }
        onOpenChange(value)
      }}
    >
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
            <span className="trace-caption">PLANKTON · UNDER THE TILES</span>
            <Dialog.Close asChild>
              <button aria-label="Close Plankton explanation">
                <X size={18} />
              </button>
            </Dialog.Close>
          </header>
          <Dialog.Title>One edit. Same world.</Dialog.Title>
          <Dialog.Description>
            Change a pixel. Follow it into the live game.
          </Dialog.Description>
          <div className="trace-vocabulary" aria-label="Choose a tile to trace">
            {definitions.map((item) => (
              <button
                key={item.id}
                disabled={busy}
                aria-label={`Trace ${item.id}`}
                aria-pressed={definition?.id === item.id}
                onClick={() => choose(item)}
              >
                <Pixels
                  sprite={artwork(item, 'word')}
                  color={ink(item, 'word')}
                />
              </button>
            ))}
          </div>
          {definition && (
            <ol
              className={`edit-trace ${before && !dirty ? 'trace-applied' : ''}`}
              aria-label="Tile edit through Plankton"
            >
              <li className="trace-node trace-editor">
                <div className="trace-title">
                  <span>1</span>
                  <h3>Edit the tile</h3>
                  <small>
                    {dirty
                      ? 'Unsaved pixels'
                      : before
                        ? 'Applied'
                        : 'Click a pixel'}
                  </small>
                </div>
                <div className="trace-edit-content">
                  <div
                    className="trace-pixels"
                    aria-label="Trace pixel editor"
                    style={{
                      gridTemplateColumns: `repeat(${draft[0].length}, 1fr)`,
                    }}
                  >
                    {draft.flatMap((row, y) =>
                      [...row].map((pixel, x) => (
                        <button
                          key={`${x}-${y}`}
                          disabled={busy}
                          aria-label={`Trace pixel ${x + 1}, ${y + 1}`}
                          aria-pressed={pixel === '1'}
                          style={{
                            background:
                              pixel === '1'
                                ? ink(definition, tileKind)
                                : undefined,
                          }}
                          onClick={() =>
                            setPixels(
                              draft.map((line, index) =>
                                index === y
                                  ? [...line]
                                      .map((value, column) =>
                                        column === x
                                          ? value === '1'
                                            ? '0'
                                            : '1'
                                          : value
                                      )
                                      .join('')
                                  : line
                              )
                            )
                          }
                        />
                      ))
                    )}
                  </div>
                  <div className="trace-edit-tools">
                    <strong>{definition.id}</strong>
                    {definition.kind === 'entity' && (
                      <div
                        className="kind-toggle"
                        aria-label="Trace artwork kind"
                      >
                        {(['entity', 'word'] as const).map((type) => (
                          <button
                            key={type}
                            disabled={busy}
                            aria-pressed={tileKind === type}
                            onClick={() => {
                              setKind(type)
                              setPixels(null)
                            }}
                          >
                            {type}
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      className="trace-apply"
                      disabled={busy || !dirty}
                      onClick={apply}
                    >
                      {busy ? 'Applying…' : 'Apply pixel edit'}
                    </button>
                    <button
                      className="trace-link"
                      disabled={busy}
                      onClick={() => onEdit(definition, tileKind)}
                    >
                      Full editor ↗
                    </button>
                  </div>
                </div>
              </li>
              <li className="trace-node trace-slot">
                <div className="trace-connector">
                  <ArrowDown aria-hidden="true" />
                  <span>replace vocabulary Slot</span>
                </div>
                <div className="trace-title">
                  <span>2</span>
                  <h3>Extension</h3>
                  <small>key: {definition.id}</small>
                </div>
                <div className="trace-binding">
                  {before && (
                    <>
                      <span className="trace-before">{picture(before)}</span>
                      <span aria-hidden="true">→</span>
                    </>
                  )}
                  {picture(definition)}
                  <code>contribute(definitions, …)</code>
                </div>
              </li>
              <li className="trace-node">
                <div className="trace-connector">
                  <ArrowDown aria-hidden="true" />
                  <span>contribute definition</span>
                </div>
                <div className="trace-title">
                  <span>3</span>
                  <h3>
                    definitions <em>Facet</em>
                  </h3>
                  <small>{definitions.length} entries</small>
                </div>
                <div className="trace-facet" aria-label="Installed definitions">
                  {definitions.map((item) => (
                    <span
                      key={item.id}
                      className={
                        item.id === definition.id ? 'trace-chosen' : ''
                      }
                    >
                      {picture(
                        item,
                        item.id === definition.id ? tileKind : 'word'
                      )}
                    </span>
                  ))}
                </div>
              </li>
              <li className="trace-node trace-session">
                <div className="trace-connector">
                  <ArrowDown aria-hidden="true" />
                  <span>live observation → game</span>
                </div>
                <div className="trace-title">
                  <span>4</span>
                  <h3>
                    Session <em>Factory</em>
                  </h3>
                  <small className="trace-alive">
                    ● {sameSession ? 'Same session' : 'Session replaced'}
                  </small>
                </div>
                <div className="trace-game-content">
                  <div
                    className="trace-world"
                    role="img"
                    aria-label="Running game with installed artwork"
                    style={{
                      gridTemplateColumns: `repeat(${bounds.width}, 1fr)`,
                      aspectRatio: `${bounds.width}/${bounds.height}`,
                    }}
                  >
                    {Array.from(
                      { length: bounds.width * bounds.height },
                      (_, index) => (
                        <span className="trace-cell" key={index}>
                          {runtime.game.board.tiles
                            .filter(
                              (tile) =>
                                tile.x === index % bounds.width &&
                                tile.y === Math.floor(index / bounds.width)
                            )
                            .map((tile) => {
                              const item = definitions.find(
                                (entry) => entry.id === tile.type
                              )
                              return item ? (
                                <span
                                  key={tile.id}
                                  className={
                                    tile.type === definition.id
                                      ? 'trace-highlight'
                                      : ''
                                  }
                                >
                                  <Pixels
                                    sprite={artwork(item, tile.kind)}
                                    color={ink(item, tile.kind)}
                                  />
                                </span>
                              ) : null
                            })}
                        </span>
                      )
                    )}
                  </div>
                  <div className="trace-retained">
                    <strong>Still here</strong>
                    <span>Board positions</span>
                    <span>Undo history</span>
                    <span>Turn {runtime.game.board.turns}</span>
                    <small>Input paused</small>
                  </div>
                </div>
              </li>
            </ol>
          )}
          <div className="trace-status" role="status">
            {error ||
              (before
                ? 'Definition replaced. Session retained.'
                : 'This edits real artwork in the running game.')}
          </div>
          {before && (
            <button
              className="trace-link"
              disabled={busy}
              onClick={async () => {
                if (await onPublish(before)) {
                  setBefore(null)
                  setPixels(null)
                }
              }}
            >
              Restore original pixels
            </button>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
