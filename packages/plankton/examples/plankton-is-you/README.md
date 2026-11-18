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

`registry.ts` defines Facets for definitions, actions, starter puzzles, and
outcomes. Built-ins and runtime content use real `contribute(...)` Bindings.
Static content is an array of Bindings; no Factory is needed for each word.

A session Factory owns the board, exposes it through a Service, and observes the
three live behavior inputs. Its `start` evaluates the initial outcome after
publication. Definition and action Slots can be replaced while that Factory and
its dependencies survive. Replacements are awaited while the UI disables input.
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

Outcome policies are independent extensions in the `outcomes` Facet. The initial
policies are visible in the tray:

- Lose when no entity has player control, including when YOU is disconnected or
  every controlled entity is destroyed.
- Win when a controlled entity shares a cell with a winning entity, including an
  entity that is both YOU and WIN.

The board status is `playing`, `won`, or `lost`. Loss takes priority if policies
conflict. There are no time-based turns. A turn resolves in this order:

1. Read the starting rules for input and blocking.
2. Move controlled entities and push words.
3. Read the resulting rules and schedule each entity/action pair once.
4. Execute turn actions in entity/contribution order.
5. Read the final rules and evaluate all outcome policies.

A destroyed YOU cannot win by briefly overlapping WIN before destruction. Won or
lost boards stop turns but remain editable. Removing/placing a tile evaluates the
outcome immediately; closing the editor reevaluates after vocabulary changes.
Undo restores the previous board, including its outcome and facing. It preserves
the currently installed definitions and actions.

The placement tools are a sandbox and can bypass the intended puzzle. Noun
transformations, arbitrary runtime JavaScript, and persistent storage remain
outside this slice.
