# Plankton Is You

A small rule-pushing game where the player can invent the vocabulary and behaviors
needed to solve the puzzle. Draw a new tile, give a property word an action, or
rewrite the conditions for winning. Each edit changes the running world while
preserving the game session and its movement history.

The example demonstrates how Plankton assembles an application from independent
contributions. Its built-in content and runtime-authored content use the same
extension contracts. A property word refers to a separately contributed action;
an outcome row refers to separately contributed selectors and predicates. Those
relationships let the player extend both the game's vocabulary and what that
vocabulary can express.

## Run it

This is a standalone React/Vite package with its own dependencies, lockfile, and
locally bundled fonts. It requires Node 22.12+ and does not start Design Studio,
the modeling engine, or generated Wasm.

From this directory:

```sh
npm ci
npm run dev
```

Move with arrows or WASD, wait with Space, and undo with Z. Words form board rules
left-to-right or top-to-bottom, such as `PLNK IS YOU` and `BUSH IS STOP`.

Approach the right edge and click **Editor** to pause and author content. The
installed vocabulary and outcome board share one palette of pixel tiles. Selecting
an item opens its details tray; close the tray or select the same item again to
clear the selection. The left **Plankton** drawer maps the live contributions and
lets the reader expand the relationships described below.

`npm test` runs the game and real Registry integration tests. `npm run build`
typechecks the example and produces `dist/`. npm installs Plankton as a local copy;
reinstall that dependency after changing the parent package.

## One session, replaceable contributions

The **game session** is the running `Game` instance: its board, placed tile IDs,
facing directions, turn count, and undo history. [`openGame`](src/registry.ts)
creates it through one Plankton **Factory**, which manages that instance's
lifetime. The Factory provides a **Service**, `game.session`, so the app can obtain
the running game. Disposing the Registry ends the session's lifetime; the Vite
integration does this on module replacement.

Content lives in separate **Slots**, each holding a replaceable group of
extensions. Saving a definition, installing an action, or applying an outcome
program replaces the corresponding Slot's children. The session Factory remains
installed, so those operations do not reconstruct the board or erase its history.

The session follows content through **observations** of four Facets. A **Facet**
collects contributions under a shared contract and combines them into a value the
consumer can read. The game reads its current definitions, actions, meanings, and
outcome program when resolving a turn or reevaluating the board. An already placed
tile therefore picks up changed artwork or behavior through its definition ID.

The session receives observations during construction and first reads them in its
`start` callback, after publication. Later reads happen in game operations. Its
in-memory state needs no external resource cleanup; the example keeps the owned
session alive while replacing its inputs.

## Extension points that use other extension points

The shared [`gameContract`](src/registry.ts) defines five Facets and the session
Service. Their values describe different parts of the game:

| Facet | What extensions contribute | How the contribution uses other content |
| --- | --- | --- |
| `puzzles` | A setup with fixed bounds, starting definitions, and placements | The selected puzzle supplies the initial vocabulary and board. |
| `definitions` | Entity sprites, noun words, property words, and language words | A property definition names an action from `actions`; each definition also contributes a physical-word selector to `outcomeMeanings`. |
| `actions` | Movement/outcome capabilities, turn callbacks, or contact callbacks | Callbacks can query active properties and use the game's movement and contact operations. |
| `outcomeMeanings` | Entity/word selectors, unary predicates, and binary relations | These meanings interpret the vocabulary used by outcome rows. |
| `outcomeProgram` | A parsed collection of outcome rows | Rows refer to selectors and predicates by ID and role, resolving their current implementations during evaluation. |

A **definition** supplies a tile type's artwork and classification. An entity
supplies both an entity sprite and its noun word. A **property** is a word whose
action applies to entities through a board sentence. For example:

```text
BUSH IS DIE
        │
        └─ DIE property → action ID → action contribution
```

Changing DIE's action changes what the existing sentence does. Replacing an action
under the same ID changes every property that uses it. Outcome programs have the
same separation: the player edits rows, while extensions supply what their words
mean. Editing a sentence and replacing its predicate are distinct operations.

### How edits become extensions

A **Binding** publishes a contribution through
`contribute(facet, () => value)`. Static arrays group the built-ins without creating
a Factory for each definition or action. Runtime authoring compiles records into
Bindings and installs them with the same API.

Binding keys select contributions within one Facet. Authored definitions use
`high` precedence and the definition's ID as their key, overriding the built-in
entry while placed instances keep their IDs and positions. Outcome meanings use
role-qualified keys, such as `relation:IS` and `word-selector:IS`, so the IS
predicate and selection of physical IS words can be replaced independently.

The publishing methods in `registry.ts` await `registry.replace` before updating
their authoring records. New contributions become visible together; subsequent
game operations read the updated Facets. Publishing content itself advances no
turn. Vocabulary edits are reevaluated when the editor closes, and applying an
outcome program reevaluates immediately.

## Try the extension model

### Give a new word an existing action: DIE

The starter puzzle separates the player from the flag with a hedge. Its control
and winning sentences are protected so the intended solution is to author a way
through the bushes.

1. In the Editor, choose **+ → Word**, name it DIE, and select **Destroy self**.
2. Paint the word if desired, then **Create definition**.
3. Choose **Place tile**, paint the empty cell after the bottom `BUSH IS` sentence,
   and accept with the checkmark.
4. Move or wait. The bushes disappear; reach the flag.

This creates a property definition referring to an existing action. Entity and
word artwork can both be edited, including the built-ins, and every view uses the
same installed definitions.

### Contribute a new action: MOVE

1. Create a word named MOVE and choose **+ New action**.
2. Set **Trigger → At turn end**, **At turn end → Step forward**, and
   **If blocked → Reverse and retry**.
3. **Install action**, then **Create definition** for the word.
4. Place MOVE after `BUSH IS` and accept. Move or wait to advance the bushes.

An **action recipe** describes a trigger, property conditions, and effects. The
recipe compiler produces ordinary `Action` callbacks and publishes them through
the actions Facet. The turn engine needs no branch for the name MOVE. Installing
another action with the same ID replaces its behavior without replacing the
session.

The form supports turn-end movement or self-destruction, and attempted-contact
effects that destroy either participant or block movement. Conditions require or
exclude properties on this entity, or on the other participant for contact
triggers. Extensions written in TypeScript can contribute other callbacks through
that same contract; the form does not execute JavaScript text or reconstruct
arbitrary callbacks into editable recipes.

### Compose entities and actions: DOOR, KEY, LOCK, OPEN

1. Create DOOR and KEY as entities.
2. Create LOCK as a property word using **Block movement**.
3. Create OPEN as a word with a new **Attempted contact** action.
4. Add **Other entity → Has property → LOCK**, then effects **Destroy → Other
   entity** and **Destroy → This entity**. Install the action and create the word.
5. Place `DOOR IS LOCK`, `KEY IS OPEN`, and `KEY IS PUSH`, then put a key in front
   of the player and a door beyond it.

Pushing the key attempts contact with the door before resolving blocking. The
OPEN callback sees LOCK, consumes both participants, and leaves the cell free.
PUSH is a built-in contribution; DOOR, KEY, LOCK, and OPEN use ordinary authored
definitions and recipes. Their names have no special handling in the engine.

Movement, push chains, and contact effects are staged together. A failed push
restores the whole attempt, including any key/door destruction. Undo restores a
successful interaction as one turn. Word tiles are always pushable; entity contact
actions run for entity pairs. Unmarked, nonblocking entities may share cells.

## Edit the outcome language

An **outcome program** is a collection of rows with three condition cells and a
result, separate from the sentences placed on the playable board. The four
starting rows are:

```text
YOU IS NONE    → LOSE
YOU TOUCH WIN  → WIN
YOU IS WIN     → WIN
YOU TOUCH LOSE → LOSE
```

YOU selects controlled entities; WIN and LOSE select entities carrying winning or
losing actions. NONE tests an empty selection. IS tests shared tile identity or
connects a subject to NONE. TOUCH tests whether two distinct selected tiles share
a cell. These executable meanings are contributions to `outcomeMeanings`.

Other noun words select their entities, and property words select entities with
that property. Physical word selection is also contributed for every definition:
`BUSH TOUCH IS → WIN` selects BUSH entities and physical IS word tiles. IS keeps
its relation meaning when used in the middle cell.

For a noun or property word, select its subject or target cell and choose
**Outcome selection → Word tiles** to use the physical word instead of its entity
meaning. The row displays a small `word` badge. This distinction preserves the
normal `YOU IS NONE` loss even while a physical YOU word remains on the board.

Add a row, select its cells, and choose tiles from the vocabulary or the tray's
**Outcome tile** dropdown. Rows and selector choices can be undone or restored to
the defaults before applying. **Apply outcomes** parses the entire draft before
replacing the program Slot. Errors appear directly below the table, and an invalid
draft leaves the installed program intact. This is an application parsing
boundary; these tests do not exercise failed Factory acquisition.

Evaluation resolves the saved selector/predicate references against live meanings.
Replacing a predicate extension changes an applied row without recompiling it.
LOSE takes precedence over WIN when both match. An empty program never ends play;
won and lost boards remain editable. Under the defaults, losing every YOU entity
reports **No YOU entities remain**.

## Paint board setups

**Place tile** enters a paused placement mode. Both sidebars hide and leave room
for four tools on the right edge:

- **Add** opens a palette of installed entities and words. Click or drag to replace
  every tile in a visited cell with the equipped tile.
- **Delete** clears whole cells, including mixed entity/word stacks.
- **Accept** commits the draft as one board edit; Z undoes the complete batch.
- **Cancel**, or Escape, discards it. Escape closes an open palette first.

Draft painting changes the preview without changing the running Game or resolving
outcomes. Accept evaluates the completed board without advancing a turn. The brush
fills gaps between pointer samples and projects captured drags onto boundary cells
when the pointer moves outside the board.

Board edits and vocabulary edits have different histories. Definition edits are
not part of board undo. Deleting an unused definition also removes its historical
tile references so Undo cannot restore tiles with no definition. Clear its placed
tiles and applied outcome references before deleting it. Reset restores the
starting board with authored content still installed; page reload starts fresh.
There is no persistent storage in this example.

## Where to read the code

| File | Responsibility |
| --- | --- |
| [`src/registry.ts`](src/registry.ts) | Contracts, contributions, Slots, session acquisition, and publishing edits. |
| [`src/content.ts`](src/content.ts) | Starter puzzle, vocabulary, and property-definition compilation. |
| [`src/actions.ts`](src/actions.ts) | Built-in actions and runtime recipe compilation. |
| [`src/outcomes.ts`](src/outcomes.ts) | Selector/predicate contracts, row parsing, and outcome evaluation. |
| [`src/game.ts`](src/game.ts), [`src/movement.ts`](src/movement.ts) | Board history, turn order, and transactional movement/contact behavior. |
| [`src/main.tsx`](src/main.tsx), [`src/board-edit.ts`](src/board-edit.ts) | UI authoring state and immutable placement drafts. |

The game engine receives ordinary functions for reading its vocabulary. It imports
no Plankton APIs; `registry.ts` adapts the extension system to those functions.
React, Radix, and the shared UI components handle browser interaction. Keeping
those responsibilities separate makes the assembly contract readable without
turning movement or painting into a second extension framework.

## Plankton concepts beyond this example

The demo exercises Facets, Contracts, Bindings, keys/precedence, Slots, retained
Factory identity, observations, and one Service provider. It does not acquire a
shared external resource through constructor dependencies, switch live Service
providers, or install plugins and feature gates. Its sources return contribution
records rather than following changing Signals, and its diagnostics remain in
tests. A game feature such as shared audio would give resource ownership, startup,
cleanup, and acquisition-failure recovery a concrete use to demonstrate next.
