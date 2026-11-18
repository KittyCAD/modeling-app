# Plankton Is You

A standalone, turn-based puzzle about editing its own vocabulary. This sample
uses the local Plankton package; it imports no ZDS code and needs no ZDS install,
account, engine, or generated WASM. Node 22.12+ is required by the build tools.

From this directory:

```sh
npm ci
npm run dev
```

Open the localhost URL printed by Vite. `npm test` runs the domain and real
Registry integration tests; `npm run build` typechecks and produces `dist/`.
The sample has its own dependencies, lockfile, and Vite configuration. Local
fonts ship in the build. Its npm configuration installs the local Plankton
package as a copy, so source imports resolve entirely within this sample's
installation. After changing Plankton itself, reinstall the local dependency.

## Play the first puzzle

1. Move with arrows or WASD. The board fills the viewport within its bounds;
   the surrounding area is letterboxed. The hedge blocks the flag, and bushes
   enclose `PLNK IS YOU`. `BUSH IS STOP` and `FLAG IS WIN` are on the far side of the hedge.
2. Click any tile to edit its definition, or move the cursor near the right
   edge and click the editor as it peeks out. Vocabulary appears above live rules.
3. Choose an entity or word from the vocabulary. Paint its pixels and publish.
   Entities use 8 × 8 sprites; words start with editable 16 × 16 pixel lettering.
   Editing pixels preserves a word's rule identity. A new entity name adds a noun.
4. Choose **New property**, enter DIE, and choose **At turn end: destroy this
   entity**. Publish, then edit the new word's pixels if desired.
5. Click **Place tile** for the DIE word. Click the ordinary empty cell after
   the bottom `BUSH IS` sentence. There is no special placement tile.
6. Move or press Space to advance a turn. The bushes disappear; reach the flag.

An entity that is both YOU and WIN also wins without touching a separate flag.
The protected starting sentence prevents that shortcut before clearing the bushes.

The drawer pauses character input. Palette placement also pauses play until a
cell is chosen, Escape is pressed, or **Resume play** is clicked. Closing the
drawer restores board focus. Nothing advances on a timer. Publishing changes the
vocabulary immediately; turn effects run on the next movement or Wait action.
Click a placed tile, then **Remove tile** to delete that instance. The editor's
Undo button or Z after resuming restores removals, placements, and turns. Reset reloads the puzzle while keeping authored
extensions. Reloading the page starts fresh.

## Where Plankton participates

- `registry.ts` defines the shared definition, puzzle, and session contracts.
  Each built-in definition becomes a real `contribute(...)` Binding, exactly as
  authored definitions do. The starter puzzle is contributed to its own Facet.
- A Puzzle has fixed bounds, starting definitions, and starting placements.
  `loadPuzzle(id)` resolves a contribution and installs its starting vocabulary.
  Puzzle authoring and durable save/load are future work; these are in-memory
  TypeScript definitions, not a serialization format.
- One Factory creates the game session and exposes it through a Service for the
  UI. Its live Facet observation is first read by game actions after publication.
- Starting definitions and authored definitions live in separate Slots. Authored
  bindings use higher precedence with definition IDs as facet-local keys, so a
  BUSH update replaces its definition without replacing the session.
- Publishing awaits `Registry.replace`. The UI disables input while it runs.
  This sample has no background reconfiguration or per-turn registry mutation.
- The Extensions view displays contributions and their actual selected precedence
  as built-in/authored provenance. It also shows the property wiring.
- `game.ts` knows nothing about Plankton. Rules are horizontal/vertical
  `noun IS property` sentences. Properties supply movement capabilities and
  optional turn effects; the engine has no DIE case.
- Disposal unmounts the Registry, including on Vite hot replacement. React owns
  input listeners and Radix owns focus trapping and modal interaction.

## Deliberate limits

The authoring language currently offers destruction and blocking recipes.
Arbitrary JavaScript, MOVE, noun transformations, file persistence, and a full
puzzle editor are outside this slice. The placement palette is an unrestricted
sandbox and can bypass the intended puzzle; follow the walkthrough for the
extension demonstration. Word tiles are always pushable. End-of-turn destruction
settles before checking victory. Undo restores board state under the currently
installed vocabulary; it does not roll back extension edits.
