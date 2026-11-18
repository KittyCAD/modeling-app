# Plankton Is You

A standalone puzzle about editing its vocabulary and behavior while it runs.
It imports the local Plankton package, with no ZDS code, account, engine, or WASM.
Node 22.12+ is required by the build tools.

From this directory:

```sh
npm ci
npm run dev
```

`npm test` runs the domain and real Registry integration checks. `npm run build`
typechecks and produces `dist/`. The sample has its own dependency installation,
lockfile, locally bundled fonts, and Vite configuration. npm installs Plankton as
a local copy; reinstall that dependency after changing Plankton itself.

## Play and edit

The world fits its fixed bounds in a letterboxed viewport. Move with arrows or
WASD, wait with Space, and undo with Z. Click any tile, or approach the right edge
and click the revealed editor handle. Editing pauses player input.

The editor shows pixel-rendered live rules first, then installed vocabulary.
Selecting a tile opens one tray: entity/word artwork, name, ink, pixel canvas, and
property action. An entity also supplies its noun word; toggle between the two
artworks. Property words such as YOU have no entity artwork. The plus at the end
of the vocabulary creates a new entity or word.

To solve the bush puzzle:

1. Choose **+ → Word**, name it DIE, and select **Destroy self** as its action.
2. Paint its word pixels if desired, then **Create definition**.
3. **Place tile** in the ordinary empty cell after the bottom `BUSH IS` sentence.
4. Move or wait. The bushes disappear; reach the flag.

`PLNK IS YOU` is enclosed by bushes. `BUSH IS STOP` and `FLAG IS WIN` start beyond
the hedge, so their words cannot be rearranged before opening the path.

Click a placed tile to **Remove tile**; Undo restores the instance. **Delete
definition** removes an unused vocabulary entry. First remove any placements of
that definition, including its noun words. Definition edits/deletions are not part
of board undo. Reset restores the starting setup while keeping authored content;
page reload starts fresh. Placement pauses play until a cell is chosen or Escape
is pressed.

## Author MOVE while playing

1. Choose **+ → Word**, and name it MOVE.
2. Choose **+ New action** in the tray. Name the action MOVE.
3. Set **At turn end → Step forward** and **If blocked → Reverse and retry**.
4. **Install action**, then **Create definition**. The property refers to the
   independently contributed action by ID.
5. Place its word after `BUSH IS`. Each bush steps in its facing direction every
   turn, reversing and retrying if blocked. Entities initially face right; player
   movement changes facing. Waiting also advances autonomous actions.

Installing an action does not move the board. Turn callbacks run on the next
movement/wait. Replacing an action with the same ID changes existing properties'
behavior without replacing the game session or undo history. Unknown action IDs
have no behavior; the tray requires a currently installed action to save a new
property. The recipe UI currently composes forward movement, reversal, and
self-destruction. It does not execute arbitrary text as JavaScript.

## Plankton contracts

`registry.ts` defines Facets for definitions, actions, starter puzzles, outcome
word meanings, and the compiled outcome program. Built-ins and runtime content
use real `contribute(...)` Bindings.
Static content is an array of Bindings; no Factory is needed for each word.

A session Factory owns the board, exposes it through a Service, and observes the
four live behavior inputs. Its `start` evaluates the initial outcome after
publication. Definition, action, outcome-artwork, and outcome-program Slots can
be replaced while that Factory and its dependencies survive. Replacements are awaited while the UI disables input.
Registry disposal runs on Vite hot replacement; React removes input listeners.

A Puzzle describes bounds, starting definitions, and placements. Starter setups
are consumed from their Facet. Durable save/load and a full setup editor are
future work; executable definitions are not a serialization format.

`game.ts` imports no Plankton or built-in content. Properties refer to action IDs;
actions provide input/collision capabilities or a turn callback. Extensions can
contribute arbitrary TypeScript callbacks through the same contract as recipes:

```ts
contribute(gameContract.actions, () => ({
  id: 'HOP',
  label: 'Hop',
  description: 'Attempt two forward steps at turn end.',
  afterTurn(subject, turn) {
    const direction = subject.facing ?? { x: 1, y: 0 }
    if (turn.move(subject.id, direction)) {
      turn.move(subject.id, direction)
    }
  },
}), { key: 'HOP' })
```

An action can move an entity (using ordinary blocking and word pushing), change
its facing, or destroy it. `turn.move` returns false and rolls back its whole push
chain when blocked. Each entity/action pair executes once per turn, even if two
properties select the same action. Runtime recipes compile to those ordinary
callbacks. Actions needing resources could instead be contributed by a Factory
that captures injected resources and owns their cleanup.

## Outcomes and turn order

The editor has a separate outcome board with four starting tile rows:

```text
YOU IS NONE    → LOSE
YOU TOUCH WIN  → WIN
YOU IS WIN     → WIN
YOU TOUCH LOSE → LOSE
```

The arrow is fixed editor layout. Select a cell to open the shared word tray,
choose another outcome word, or paint its pixels. Artwork is shared by all uses
of that word in the outcome board. The ordinary puzzle and outcome vocabularies
have separate meanings; matching word names initially reuse puzzle word artwork.
An outcome word's artwork can be overridden independently.

Add or remove rows, remove individual tiles, undo draft edits, or restore the
four defaults. **Apply outcomes** parses the whole draft before replacing the
installed program. Incomplete or ill-typed rows report an error and leave the
running program intact. Removing an entire row is valid. An empty program is
also valid and never ends play. Draft edits survive closing the drawer; only
applied rows affect the game. Reset reloads the puzzle under the currently
installed outcome program. Page reload restores all defaults.

The `outcomeWords` Facet receives six real word contributions:

- YOU, WIN, and LOSE select controlled, winning, and losing entities respectively.
- NONE is a unary predicate that tests whether its selected set is empty.
- IS is a relation predicate that tests shared entity identity. In `IS NONE`, it
  also serves as the grammar's connector to the unary predicate.
- TOUCH is a relation predicate that tests distinct entities sharing a cell.

`YOU IS NONE` therefore covers disconnected YOU sentences, destruction of the
last YOU entity, and a connected `BUSH IS YOU` sentence with no bushes. Another
surviving YOU entity keeps the selection nonempty. Its loss message is
**No YOU entities remain**.

**Lose on contact** remains an available action. A sentence such as
`LAVA IS DANGER`, with DANGER using that action, adds lava to the LOSE selection.
The fourth outcome row then ends play when YOU touches lava, even if another YOU
survives. The action does not destroy entities. Its default predicate message is
**YOU touched a losing entity**. Removing that outcome row removes this loss
condition while preserving the action and property.

`parseOutcomeRows` converts tile choices into a typed program of selector and
predicate IDs. It captures no predicate callback. Each evaluation resolves those
IDs from live contributions, so replacing NONE, IS, or TOUCH changes existing
rows without recompiling them. Missing or mismatched meanings make a dependent
rule inactive. Predicate callbacks are TypeScript extensions; the tray edits
artwork and sentence choices, not executable JavaScript.

The `outcomeProgram` Facet holds that parsed data, installed through its own Slot.
Changing the program preserves the session, tile positions, turn count, and board
undo history. Undo restores board contents and reevaluates them using the current
program. Outcome draft undo is separate and requires Apply to affect play.

The board status is `playing`, `won`, or `lost`; a loss includes its matching row
and predicate message. LOSE results take priority over WIN regardless of row
order. This is a fixed interpreter policy. There are no time-based turns. A turn
resolves in this order:

1. Read the starting rules for input and blocking.
2. Move controlled entities and push words.
3. Read the resulting rules and schedule each entity/action pair once.
4. Execute turn actions in entity/contribution order.
5. Read the final rules and evaluate the installed outcome program.

Under the starting program, a destroyed YOU cannot win by briefly overlapping
WIN before destruction. Won or lost boards stop turns but remain editable. Removing/placing a tile evaluates the
outcome immediately; closing the editor reevaluates after vocabulary changes.
Undo restores the previous tiles and facing, then reevaluates the outcome. It
preserves the currently installed definitions and actions.

The placement tools are a sandbox and can bypass the intended puzzle. Noun
transformations, arbitrary runtime JavaScript, and persistent storage remain
outside this slice.
