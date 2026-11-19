import type { ReactNode } from 'react'
import type { Definition, Tile } from './game'
import type { Runtime } from './registry'
import { TileArt } from './tile-art'
import { Drawer } from './ui'

function Branch({
  kind,
  name,
  children,
  open = false,
}: {
  kind: string
  name: ReactNode
  children: ReactNode
  open?: boolean
}) {
  return (
    <details className="concept" open={open}>
      <summary>
        <span className="concept-kind">{kind}</span>
        {name}
      </summary>
      <div className="concept-children">{children}</div>
    </details>
  )
}

/** Nest contribution data and label references; Facets are aggregation points, not owners. */
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
  onOpenChange(open: boolean): void
  onEdit(definition: Definition, kind: Tile['kind']): void
}) {
  const definitions = runtime.definitions.value
  const actions = runtime.actions.value
  const meanings = runtime.outcomeMeanings.value
  const program = runtime.outcomeProgram.value
  const tile = (definition: Definition) => (
    <span className="concept-tile">
      <TileArt definition={definition} />
    </span>
  )
  const action = (id: string) => {
    const entry = actions.find((item) => item.id === id)
    return entry ? (
      <Branch kind="Action" name={entry.label}>
        <p>{entry.description}</p>
        <small>
          {entry.onContact
            ? 'Contact callback'
            : entry.afterTurn
              ? 'Turn callback'
              : 'Movement / outcome capability'}
        </small>
      </Branch>
    ) : (
      <small>Missing action: {id}</small>
    )
  }
  return (
    <Drawer
      side="left"
      title="Plankton in this world"
      description="Explore the live contributions and how Plankton connects them."
      label="How Plankton works"
      open={open}
      peek={peek}
      onOpenChange={onOpenChange}
    >
      <div className="concept-map">
        <Branch kind="Facet" name={`puzzles · ${runtime.puzzles.value.length}`}>
          {runtime.puzzles.value.map((puzzle) => (
            <Branch key={puzzle.id} kind="Puzzle" name={puzzle.title}>
              <small>
                {puzzle.bounds.width} × {puzzle.bounds.height} bounds ·{' '}
                {puzzle.placements.length} starting placements
              </small>
              <p>Starting definitions → definitions Facet</p>
              <div className="concept-tiles">
                {puzzle.definitions.map((item) => (
                  <span key={item.id}>{tile(item)}</span>
                ))}
              </div>
            </Branch>
          ))}
        </Branch>
        <Branch kind="Facet" name={`definitions · ${definitions.length}`}>
          {definitions.map((definition) => (
            <Branch
              key={definition.id}
              kind={definition.kind}
              name={
                <>
                  {tile(definition)}
                  {definition.id}
                </>
              }
            >
              {definition.kind === 'entity' && (
                <div className="concept-tiles">
                  <span className="concept-tile">
                    <TileArt definition={definition} kind="entity" />
                  </span>
                  {tile(definition)}
                  <small>Entity + noun word</small>
                </div>
              )}
              {definition.kind === 'property' && (
                <>
                  <small>Refers to actions Facet ↓</small>
                  {action(definition.action)}
                </>
              )}
              {meanings
                .filter((meaning) => meaning.id === definition.id)
                .map((meaning) => (
                  <Branch
                    key={meaning.id}
                    kind={meaning.kind}
                    name="From outcomeMeanings Facet"
                  >
                    <p>{meaning.description}</p>
                  </Branch>
                ))}
              {definition.kind === 'grammar' && (
                <small>Sentence connector</small>
              )}
              <button
                className="text-button"
                onClick={() => onEdit(definition, 'word')}
              >
                Edit {definition.id} word ↗
              </button>
            </Branch>
          ))}
        </Branch>
        <Branch kind="Facet" name={`actions · ${actions.length}`}>
          {actions.map((entry) => (
            <div key={entry.id}>{action(entry.id)}</div>
          ))}
        </Branch>
        <Branch kind="Facet" name={`outcomeMeanings · ${meanings.length}`}>
          {meanings.map((meaning) => (
            <Branch key={meaning.id} kind={meaning.kind} name={meaning.id}>
              <p>{meaning.description}</p>
            </Branch>
          ))}
          <small>
            Entity and property selectors also derive from definitions.
          </small>
        </Branch>
        <Branch
          kind="Facet"
          name={`outcomeProgram · ${program.rows.length} rules`}
        >
          <small>
            Vocabulary tiles → contributed predicate meanings → WIN / LOSE
          </small>
          {program.rows.map((row) => (
            <div
              className="concept-tiles"
              key={row.id}
              aria-label={row.cells.join(' ')}
            >
              {row.cells.map((id, index) => {
                const definition = definitions.find((item) => item.id === id)
                return (
                  <span key={index}>
                    {index === 3 && '→ '}
                    {definition ? tile(definition) : id}
                  </span>
                )
              })}
            </div>
          ))}
        </Branch>
        <Branch kind="Slots" name="Replaceable contributions">
          <ul>
            <li>Vocabulary → definitions</li>
            <li>Authored actions → actions</li>
            <li>Authored meanings → outcomeMeanings</li>
            <li>Outcome rows → outcomeProgram</li>
          </ul>
          <small>Replacing contributions retains the session Factory.</small>
        </Branch>
        <Branch kind="Factory" name="session" open>
          <Branch kind="Service" name="game.session">
            <small>Exposes the same running Game instance.</small>
          </Branch>
          <Branch kind="Observations" name="Live game inputs">
            <ul>
              {[
                'definitions',
                'actions',
                'outcomeMeanings',
                'outcomeProgram',
              ].map((name) => (
                <li key={name}>← {name} Facet</li>
              ))}
            </ul>
          </Branch>
          <small>
            Board, turn {runtime.game.board.turns}, and undo history stay alive.
          </small>
        </Branch>
      </div>
    </Drawer>
  )
}
