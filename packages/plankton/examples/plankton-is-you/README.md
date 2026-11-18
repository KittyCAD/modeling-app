# Plankton Is You

This runnable Plankton example lets a player change an application's vocabulary,
behavior, and terminal rules while its current session continues. Creating DIE
adds a word and a destruction action to a puzzle. Creating MOVE supplies another
behavior. Editing `YOU IS NONE → LOSE` changes when that same puzzle ends.

Plankton assembles the definitions and behaviors; ordinary game functions apply
them to tiles. The sample is a standalone package with React, Radix Dialog, and
Vite. It imports no ZDS runtime and needs no account, engine, or generated WASM.
Node 22.12+ is required.

From this directory:

```sh
npm ci
npm run dev
```

`npm test` runs the domain and real Registry integration checks. `npm run build`
typechecks and produces `dist/`. The sample has its own dependency installation,
lockfile, locally bundled fonts, and Vite configuration. npm installs Plankton as
a local copy; reinstall that dependency after changing Plankton itself.

## Follow the Plankton assembly

The game session owns the placed tiles, facing directions, turn count, and undo
history. [`openGame`](src/registry.ts) creates a Registry and installs one session
Factory. Replacing content keeps that acquired Game instance alive. Closing its
Registry ends that lifetime; Vite hot replacement calls `dispose()`. React owns
browser input listeners. The session currently owns only in-memory state, so it
has no resource finalizer.

A Facet combines independent contributions into one input for a consumer. The
shared `gameContract` keeps the tokens precisely typed:

| Facet | Contributions | Consumer |
| --- | --- | --- |
| `definitions` | Entity artwork, noun words, properties, and language words | Board renderer, word parser, shared editor |
| `actions` | Input/collision capabilities, turn callbacks, and contact callbacks | Turn engine, property-action picker |
| `outcomeMeanings` | Selector, unary-predicate, and relation implementations | Outcome parser and interpreter |
| `outcomeProgram` | Parsed tile rows | Terminal-rule interpreter |
| `puzzles` | Bounds, starting definitions, and placements | Initial setup and reset |

Built-ins and authored content use the same `contribute(facet, () => value)` API.
Static registrations are arrays of Bindings; they do not need a Factory per word.
Definition IDs are facet-local binding keys. An authored BUSH binding has `high`
precedence, so it shadows the default BUSH contribution while all placed BUSH
instances keep their IDs and positions. This key selects a contribution; it does
not identify or restart a resource.

Slots hold replaceable content: the vocabulary, authored actions, authored
predicate meanings, and outcome program. `publish`, `publishAction`,
`publishOutcomeMeaning`, and `publishOutcomeRows` compile their authoring records
into Bindings and await `registry.replace`. A replacement publishes the new
contribution group together and retains the session. Publishing MOVE does not
advance a turn; the next movement or Wait resolves its new action.

The session receives four live observations through `scope.observe`, then passes
ordinary read functions into Game. Construction does not read those observations.
Its `start` evaluates the initial outcome after publication. Later turns read the
current definitions, actions, meanings, and program, so no permanent reference to
an old action or predicate is captured. These are event-time reads; this example
does not demonstrate an ongoing reactive effect or a Signal-backed Binding.

A Service exposes the selected session capability to the UI. The Factory supplies
it with `provide(gameContract.session, game)`; composition reads it through
`registry.required`. Only one provider is installed here. Missing/conflicting
Service providers and live provider switching are not exercised.

Outcome authoring has a separate boundary before Registry mutation:
`parseOutcomeRows` turns a complete draft into a typed program. Invalid drafts
never reach `replace`, so the old program remains available. This demonstrates
application-level parsing and successful atomic replacement; it does **not**
demonstrate rollback after failed Factory acquisition.

## Concepts to explore next

| Concept | Current coverage | A natural extension of this game |
| --- | --- | --- |
| Facets, Contracts, Bindings, keys and precedence | Used by built-ins and runtime edits | Add another independently contributed starter puzzle |
| Slots and retained Factory identity | Real edits preserve the session and board undo | Keep this as the main walkthrough |
| Observations and startup ordering | First read in `start`, later reads during game actions | A live preview Binding that reads a Signal without replacing the graph |
| Service selection | One provider resolved once | Swap input providers through a live Service observation |
| Constructor dependencies and shared lifetimes | No `factory.dependencies` declarations | World playback and editor preview share one audio resource |
| Resource startup/cleanup | Registry disposal is wired; no owned external resource | A sound Factory starts/stops work and releases its AudioContext |
| Plugins and feature gates | Not used | Toggle a sound plugin while retaining its metadata and controls |
| Acquisition failure and rollback | Not exercised by invalid-draft tests | Fail acquisition of a real asset/resource and retain the previous content |
| Diagnostics | `debug` is used in tests; `inspect` has no UI | Inspect contribution origins during a development walkthrough |

The most useful next addition would be a real shared resource behind an optional
plugin: it could demonstrate dependency injection, shared identity, and cleanup
together. Those concepts should follow an actual game feature; adding artificial
Factories or a diagnostic dashboard would distract from the compact consumer.

## Play and edit

The world fits its fixed bounds in a letterboxed viewport. Move with arrows or
WASD, wait with Space, and undo with Z. Click any tile, or approach the right edge
and click the revealed editor handle. Editing pauses player input.

Approach the left edge to open **Plankton**, a visual trace of a real tile edit.
Choose a tile, toggle pixels, and apply: its extension is replaced through the
vocabulary Slot, the definitions Facet updates, and the running board renders the
new artwork. A session identity check stays visible alongside the board preview.
**Restore original pixels** reverses the artwork edit; **Full editor** opens the
selected artwork in the right tray. The explanation pauses player input.

The editor shows pixel-rendered live rules first, then installed vocabulary.
Vocabulary and Outcomes stay in the main panel. Selecting a tile opens a separate
tray to its left: entity/word artwork, name, ink, pixel canvas, and property action.
Close the tray or click the selected vocabulary icon again to clear the selection.
On narrow screens the tray covers the main panel until closed.

An entity also supplies its noun word; toggle between the two
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
that definition, including its noun words, and any applied outcome references. Definition edits/deletions are not part
of board undo. Successful definition deletion also removes its tile references
from saved board history, so Undo cannot restore unusable tiles. Unrelated
movement history is preserved. Reset restores the starting setup while keeping authored content;
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
property. The recipe UI offers turn-end and attempted-contact triggers,
positive/negative property conditions, movement/reversal, destruction, and
blocking effects. It does not execute arbitrary text as JavaScript.

## Author DOOR, KEY, LOCK, and OPEN

DOOR and KEY are ordinary runtime-authored entities. LOCK and OPEN are property
words; their names and interaction are not special cases in the engine.

1. Use **+ → Entity** to draw and create DOOR and KEY.
2. Use **+ → Word** to create LOCK with the existing **Block movement** action.
3. Create a new word OPEN, then choose **+ New action**. Name the action OPEN.
4. Set **Trigger → Attempted contact**. Add the condition **Other entity → Has
   property → LOCK**.
5. Add two effects: **Destroy → Other entity**, then **Destroy → This entity**.
6. **Install action**, then **Create definition** for the OPEN word.
7. Place these ordinary sentences:

   ```text
   DOOR IS LOCK
   KEY IS OPEN
   KEY IS PUSH
   ```

PUSH is included in the starting vocabulary and selects the **Pushable** action.
Place a key in front of the player and a door beyond it. Pushing the key attempts
contact with the door before blocking is considered. The OPEN action sees LOCK,
consumes both entities, and lets the player enter the key's vacated cell. Undo
restores the complete turn. `KEY IS YOU` also works if direct key control is
preferred; PUSH is needed when another entity pushes the key.

Contact triggers run for either participant, so the same recipe works when a
LOCK entity moves into a stationary OPEN entity. Conditions query active property
sentences, not artwork or noun names. All conditions must match; each can require
or exclude a property on this entity or the other entity. Turn-end conditions
refer only to this entity. No conditions means the action runs unconditionally.

Contact effects currently destroy either participant or block movement. Blocking
cancels the whole movement attempt, including destruction staged earlier in the
same attempt. PUSH supports chains of pushable entities and word tiles. A failed
chain restores all movement and contact effects in that attempt, including a key
and door consumed before a different obstruction was found. An entity with both
PUSH and blocking can be pushed out of the way if its destination is available.
Unmarked, nonblocking entities can overlap; they are not implicitly pushed.

Recipes compile into ordinary Action objects and are installed through the same
`actions` Facet and authored-content Slot as MOVE. Replacing an action ID changes
existing property words' behavior without replacing the session or clearing undo.
The action form installs a recipe by ID; it does not reconstruct arbitrary
TypeScript callbacks into editable recipes.

## Action contribution example

`game.ts` imports no Plankton or built-in content. Properties refer to action IDs;
actions provide input/collision capabilities, turn callbacks, or contact
callbacks. Extensions can contribute arbitrary TypeScript callbacks through the same contract as recipes:

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

A turn action can move an entity (using ordinary blocking and pushing), change
its facing, destroy it, or query its active properties. `turn.move` returns false
and rolls back its whole push chain and contact effects when blocked. Each
entity/action pair executes once per turn-end schedule, even if two properties
select the same action. Runtime recipes compile to those ordinary callbacks.

`Action.onContact(subject, other, contact)` receives attempted entity contact
before blocking/pushing. The subject is the entity carrying the action, which may
be stationary. The context exposes `hasProperty`, `destroy`, and `block`, plus the
initiating mover ID and direction. Each entity/action callback runs at most once
per encountered pair in one movement attempt, while both participants remain.
Word tiles are pushable but do not receive entity contact callbacks. Tile-state effects are transactional; external
side effects performed by arbitrary TypeScript callbacks are not rolled back.
Actions needing resources could instead be contributed by a Factory that
captures injected resources and owns their cleanup.

## Outcomes and turn order

The editor has a separate outcome board with four starting tile rows:

```text
YOU IS NONE    → LOSE
YOU TOUCH WIN  → WIN
YOU IS WIN     → WIN
YOU TOUCH LOSE → LOSE
```

The arrow is fixed editor layout. There is one installed vocabulary: NONE and
TOUCH are ordinary word definitions, and LOSE is a property word using the
Lose on contact action. They appear alongside PLNK, FLAG, BUSH, IS, YOU, WIN,
and STOP, and can be placed on the playable board like other word tiles.

New outcome rows start as `_ _ _ → _`. Select a cell, then choose any word from
Installed vocabulary or the tray's Outcome tile dropdown. **Done editing cell**
returns to ordinary definition editing. Outcome rows render the same definitions
and artwork as the palette, puzzle, and shared tray; saving pixels updates every
use of that word. The grammar is checked when applying the complete draft rather
than restricting the picker to a second vocabulary.

Add or remove rows, remove individual tiles, undo draft edits, or restore the
four defaults. **Apply outcomes** parses the whole draft before replacing the
installed program. Incomplete or ill-typed rows report an error and leave the
running program intact. Removing an entire row is valid. An empty program is
also valid and never ends play. Draft edits survive closing the drawer; only
applied rows affect the game. Reset reloads the puzzle under the currently
installed outcome program. Page reload restores all defaults.

The `outcomeMeanings` Facet supplies executable language meanings without
duplicating word definitions or artwork:

- YOU, WIN, and LOSE select controlled, winning, and losing entities respectively.
- NONE is a unary predicate that tests whether its selected set is empty.
- IS is a relation predicate that tests shared entity identity. In `IS NONE`, it
  also serves as the grammar's connector to the unary predicate.
- TOUCH is a relation predicate that tests distinct entities sharing a cell.
- Other entity nouns select their matching entities automatically. Other property
  words select entities described by that property, including authored words.

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
rows without recompiling them. Meanings are resolved only for currently
installed vocabulary entries. Missing or mismatched meanings make a dependent
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
2. Move controlled entities. For each attempted entry, run contact callbacks,
   then resolve blocking and entity/word pushes. Failed attempts roll back.
3. Read the resulting rules and schedule each entity/action pair once.
4. Execute turn actions in entity/contribution order. Their movement uses the
   same contact and push resolver with the post-input rule snapshot.
5. Read the final rules and evaluate the installed outcome program.

Under the starting program, a destroyed YOU cannot win by briefly overlapping
WIN before destruction. Won or lost boards stop turns but remain editable. Removing/placing a tile evaluates the
outcome immediately; closing the editor reevaluates after vocabulary changes.
Undo restores the previous tiles and facing, then reevaluates the outcome. It
preserves the currently installed definitions and actions.

The placement tools are a sandbox and can bypass the intended puzzle. Noun
transformations, arbitrary runtime JavaScript, and persistent storage remain
outside this slice.
