# Plan: Solid properties + BOM / cut list for KCL

**Status:** Phase 2 complete — first smoke-testable slice (`setProperties` / `getProperties` / `clearProperties`)  
**Motivating use case:** timber greenhouse (and similar multi-body assemblies) where geometry is mostly rectangular stock, and the primary deliverable is a cut list / BOM that updates when parametric dimensions change  
**Related code today:** `Solid` in `rust/kcl-lib/src/execution/geometry.rs`, BOM types in `rust/kcl-lib/src/execution/bom.rs`, stdlib in `rust/kcl-lib/src/std/properties.rs`, `clone` in `rust/kcl-lib/src/std/clone.rs`, patterns in `rust/kcl-lib/src/std/patterns.rs`, GDT in `rust/kcl-lib/src/std/gdt.rs` (do **not** reuse)

---

## 1. Problem

KCL can model many studs via `clone` / `patternLinear3d`, but has no way to:

1. Attach structured fabrication data to a body (length, section, end angles, role/SKU)
2. Keep that data when the body is cloned or patterned
3. Collect all such data into a cut list after a parametric rebuild

Without this, lengthening a greenhouse by 2 m can correctly add geometry via patterns driven by length, but the cut list must be maintained by hand — which defeats the point of modeling.

GDT annotations are the wrong tool: they attach to faces/edges for MBD/inspection, do not copy on clone/pattern, and are not collectable as a part list.

---

## 2. Goals

1. **Solid-level label + free-form properties** — required `label: string` for typed grouping; free-form property map for industry-specific fields
2. **Instance propagation** — label + properties copy onto each new body from `clone`, `patternLinear3d`, `patternCircular3d`, `patternTransform`, and `mirror3d` (and any other “new body from existing body” ops we identify)
3. **Global collection** — `bom()` with no solid list returns every registered live part; `groupBom` groups primarily by `label` (then by properties as needed)
4. **Parametric workflow** — user writes geometry rules (counts from overall length, etc.); BOM is a derived output of the same program run
5. **Declared cut dimensions** — properties hold authoritative fabrication data when the user chooses to put them there; no geometric measurement in v1 (honor system)

### Non-goals (v1)

- Full assembly / component / instance system
- Automatic geometric measurement of stock length from solids (later: distance-between-vertices style helpers feeding properties)
- Putting BOM under `gdt::`
- STEP/IFC product-structure export
- Sketch-level properties
- Artifact-graph / feature-tree / MCP property blobs (out of scope for v1)
- `ImportedGeometry` properties (deferred; likely needed later)
- UI cut-list panel (phase 5 / follow-on)
- `cutList(...)` helper — follow-on that derives a mill sheet from a BOM; start with `bom` / `groupBom` only

---

## 3. Target user workflow (greenhouse)

```kcl
// Stock helper — label + properties set from the same inputs used for geometry
fn stud(length, endA = 90deg, endB = 90deg) {
  width = 45mm
  depth = 90mm
  body = // sketch rectangle + extrude + optional end miters from endA/endB
  return setProperties(
    body,
    label = "stud",
    properties = {
      sku = "90x45",
      length = length,
      width = width,
      depth = depth,
      endA = endA,
      endB = endB,
    },
  )
}

greenhouseLength = 8000mm
studSpacing = 600mm
studCount = // derived from greenhouseLength / studSpacing

// One unique length; pattern produces N bodies, each with the same label + properties
wallStud = stud(2400mm)
wallStuds = patternLinear3d(
  wallStud,
  instances = studCount,
  distance = studSpacing,
  axis = [1, 0, 0],
)

// Unique mitered pieces where needed
rafter = stud(length = rafterLength, endA = roofPitch, endB = roofPitch)
rafters = clone(rafter) |> translate(...) // label + properties follow

// After the whole structure is built — no manual solid list to maintain:
parts = bom()                 // every registered live part
summary = groupBom(parts)     // group by label (+ properties); qty per distinct cut
println(summary)
// later: cutList(summary) or cutList(bom()) for timber-oriented mill sheet
```

Changing `greenhouseLength` changes `studCount`, patterns create more/fewer bodies, `bom()` / `groupBom()` update automatically.

---

## 4. Locked API

### 4.1 Set / get / clear

```kcl
setProperties(
  @solid: Solid,
  label: string,
  properties: { _ },
) -> Solid

getProperties(@solid: Solid) -> { label: string, properties: { _ } } // exact return shape: see §11
clearProperties(@solid: Solid) -> Solid
```

- **`label` is required** and separate from the free-form map — it is the stable grouping key (“stud”, “batten”, “glass-panel”, …)
- **`properties` is free-form** — no reserved keys inside the map; flexible across industries
- **Replace** entire properties map on each `setProperties` (v1); no merge helper yet
- **Value types:** string, number (units preserved), bool, nested plain objects of the same; reject geometry values
- Pipe-friendly: `extrude(...) |> setProperties(label = "stud", properties = { length = 1550mm })`

### 4.2 Collect

```kcl
bom() -> [{ label: string, properties: { _ } }]   // global; no solids arg in v1
groupBom(entries) -> [{ label: string, properties: { _ }, qty: number(_) }]
```

- **`bom()` takes no solid list** — maintaining an explicit array of every clone/pattern result defeats the feature
- Discovery via a **dedicated ExecState registry** (see §5 / §11)
- Solids never passed through `setProperties` (or cleared) do not appear
- Consumed / deleted solids do not appear; **hidden** solids still appear
- **`groupBom`:** group by `label`, and within a label by property-map equality (canonical units so `1550mm` ≡ `1.55m`)
- Follow-on (not v1): `cutList(...)` helper that turns a BOM into a timber mill sheet

**Namespace (accepted lean):** `setProperties` / `getProperties` / `clearProperties` alongside solid helpers like `appearance`; `bom` / `groupBom` as top-level or solid-module helpers — same spirit as appearance (exact module path bikeshed only).

### 4.3 What is stored on `Solid`

Extend `Solid` in `geometry.rs` with something like:

```rust
/// Required part label when properties are set (e.g. "stud"). Copied by clone / pattern / mirror.
pub label: Option<String>,

/// User-defined free-form fabrication / BOM fields. Copied by clone / pattern / mirror.
/// Not sent to the modeling engine in v1.
#[serde(default, skip_serializing_if = "IndexMap::is_empty")]
pub properties: IndexMap<String, PropertyValue>,
```

(Exact field layout — sibling `label` vs embedding — still a small open question in §11; semantically label is not just another free-form key.)

Properties + label are **KCL / ExecState data**, not engine entity attributes, and **not** mirrored onto the artifact graph in v1.

### 4.4 ExecState registry (direction)

Maintain a **dedicated piece of ExecState `GlobalState`** for BOM membership, keyed by solid `artifact_id` → `{ label, properties }`.

**Why GlobalState (not ModuleState):** per-module execution swaps `mod_local` and only persists artifacts afterward; a ModuleState registry would be discarded at end of run. GlobalState survives those swaps and is included in the execution cache via `global`.

**Intent:**

- `setProperties` registers / updates the entry
- `clone` / `pattern*` / `mirror3d` register new entries for new body ids (copying label + properties)
- `clearProperties`, consume, and `delete` remove entries
- `bom()` reads the registry (filtered to live / unconsumed)

---

## 5. Implementation phases

### Phase 0 — Design lock (this doc)

- [x] Label + free-form properties
- [x] Global `bom()` (no solid list)
- [x] ExecState registry direction
- [x] Boolean: drop + warning (not error); subtract preserves
- [x] Honor system for property vs geometry consistency
- [x] Grouping centered on `label` (+ properties equality)
- [x] No artifact-graph properties in v1
- [x] Defer `ImportedGeometry`
- [x] Name the collect API `bom`; cut-list helper later
- [x] §11 leans accepted

**Exit criteria:** met — proceed to Phase 1.

---

### Phase 1 — Runtime data model

**Status:** done (2026-07-25)

**Work:**

1. [x] Add `label` + `properties` fields to `Solid` (`rust/kcl-lib/src/execution/geometry.rs`)
2. [x] Add BOM registry on `ModuleState` / helpers on `ExecState` (`bom_register`, `bom_unregister`, …)
3. [x] KCL-side only — not sent to modeling engine; cache participation via `ModuleState` clone into `cache::GlobalState`
4. [x] `PropertyValue` enum (string / number+units / bool / nested object) in `rust/kcl-lib/src/execution/bom.rs`
5. [x] Update `Solid { ... }` construction sites (extrude, surfaces, solid_consumption tests)
6. [x] Unit tests: property map clone, registry upsert, ModuleState cache clone, ExecState helpers

**Exit criteria:** met — solids can carry label/properties in memory; registry type + helpers exist; no stdlib API yet (Phase 2).

---

### Phase 2 — Stdlib set / get / clear + registry writes

**Status:** done (2026-07-25)

**Work:**

1. [x] KCL std definitions in `solid.kcl` (`setProperties`, `getProperties`, `clearProperties`)
2. [x] Rust handlers in `rust/kcl-lib/src/std/properties.rs` + `KclValue` ↔ `PropertyValue`
3. [x] Register in `rust/kcl-lib/src/std/mod.rs`
4. [x] `setProperties` updates solid **and** registry; `clearProperties` clears both
5. [x] Tests: round-trip, reject geometry values, survive `translate`, clear unregisters
6. [x] Moved BOM registry from `ModuleState` → `GlobalState` (module `mod_local` swaps were discarding registrations)

**Exit criteria:** met — stamp/read works; registry reflects set/clear. **Smoke-testable in Design Studio now.**

---

### Phase 3 — Propagation through instance ops

**Work:** copy `label` + `properties` onto each new body; **register** each new body in the BOM registry.

| Op | File(s) | Notes |
|----|---------|--------|
| `clone` | `std/clone.rs` | Remap tags as today; copy label/properties; registry insert |
| `patternLinear3d` / `2d` | `std/patterns.rs` | Per-instance copy + registry |
| `patternCircular3d` / `2d` | same | same |
| `patternTransform` / `2d` | same | same |
| `mirror3d` | `std/mirror.rs` | Copy + registry |

Audit paths that rebuild `Solid { .. }` without cloning the full struct (must not drop label/properties).

**Suggested tests:**

- Clone preserves label/properties; mutating clone does not affect original
- `patternLinear3d` with `instances = 4` → `bom()` has 4 entries with same label
- Mirror preserves; pattern then translate still registered

**Exit criteria:** “unique stud + pattern” yields N BOM rows without listing solids by hand.

---

### Phase 4 — `bom` / `groupBom` + boolean warnings

**Work:**

1. Implement `bom()` from the ExecState registry
2. Implement `groupBom(entries)` — group by `label`, then by property equality (canonical units)
3. On `union` / `intersect` / `split` (and subtract per §11): **drop** label/properties on the result; **unregister** inputs as consumed; emit a **warning** (not an error) if any input had a label/properties
4. `delete` unregisters; `hide` leaves registry entry
5. Tests: parametric instance count → `groupBom` qty; consumed parts absent; warning fired on union of labeled parts

**Exit criteria:** end-of-file `bom()` / `groupBom()` usable for a greenhouse-scale model.

---

### Phase 5 — Docs, samples, optional UI

**Work:**

1. Std docs under `docs/kcl-std/`
2. Lang guide: “Part properties and BOM”
3. Sample timber bay / greenhouse snippet
4. Optional app UI / CSV export later
5. Document recommended timber property fields as convention only (not schema-enforced)

**Exit criteria:** documented, copy-pasteable example.

---

### Phase 6 — Follow-ons

- `cutList(...)` helper built on top of `bom` / `groupBom` for timber mill sheets
- `ImportedGeometry` properties + registry
- Distance / measure helpers to populate properties (still user-declared into the map)
- Artifact-graph / UI selection display of label+properties
- `mergeProperties` if replace-only becomes painful
- Assembly/instance model if multi-file products need stronger identity

---

## 6. Propagation and lifetime rules (locked + noted)

| Event | Behavior |
|-------|----------|
| `setProperties` | Set label + replace properties map; register/update ExecState BOM entry; engine id unchanged |
| `translate` / `rotate` / `scale` | Preserve label + properties; registry identity unchanged (same solid) |
| `clone` | Deep-copy label + properties onto new solid; **register** new entry |
| `pattern*` | Each instance deep-copies source label + properties; **register** each |
| `mirror3d` | Copy + register |
| `fillet` / `chamfer` / `shell` / holes | Preserve label + properties |
| `union` / `intersect` | **Drop** on result; unregister consumed; **warning** if inputs were labeled |
| `subtract` | **Preserve** on kept solid (lean; confirm §11 Q11); cutter ignored — notching keeps the part on the BOM |
| `split` | **Drop** + warn; user re-stamps if pieces are still stock |
| Consumed solid | Removed from registry / omitted from `bom()` |
| `hide` | Still in `bom()` |
| `delete` | Removed from `bom()` |
| Geometry vs property `length` | Honor system — no check in v1 |

---

## 7. Why not the alternatives (for context)

| Approach | Why not for this goal |
|----------|------------------------|
| Data-first placement spreadsheet | Cut list would be an input; parametric length changes wouldn’t invent new members |
| `gdt::metaData` | Wrong domain; face/edge attachment; no collect; clone doesn’t copy GDT |
| Explicit `bom(solids)` only | User must track every clone/pattern — easy to miss parts; defeats the feature |
| Measure solids for length | Mitered stock ≠ bbox; FP noise; later measure tools can *feed* free-form properties |
| Schema-enforced property keys | Too industry-specific; `label` gives the typed hook; map stays free-form |

Parametric modeling here means: **overall parameters → instance counts / unique lengths → solids with label+properties → derived `bom()`**.

---

## 8. Testing strategy summary

1. **Unit:** label + property map on `Solid`; deep copy isolation; registry insert/remove
2. **Executor tests:** set/get/clear, clone, each pattern, mirror, transforms
3. **Global `bom()`:** no user solid list; pattern instance count matches BOM length
4. **Consumption:** union drops + warning; consumed omitted from `bom()`
5. **`groupBom`:** same label + equivalent lengths (mm vs m) collapse to qty
6. **Cache:** re-exec / partial cache does not duplicate or drop registry entries (§11)

---

## 9. Rough file checklist

| Area | Paths |
|------|--------|
| Solid type | `rust/kcl-lib/src/execution/geometry.rs` |
| ExecState BOM registry | `rust/kcl-lib/src/execution/state.rs` (or nearby) |
| Std API (KCL) | `rust/kcl-lib/std/solid.kcl` and/or `bom.kcl` |
| Std API (Rust) | `rust/kcl-lib/src/std/properties.rs` (new), register in `mod.rs` |
| Clone | `rust/kcl-lib/src/std/clone.rs` |
| Patterns | `rust/kcl-lib/src/std/patterns.rs` |
| Mirror | `rust/kcl-lib/src/std/mirror.rs` |
| Booleans / consumption | `rust/kcl-lib/src/std/solid_consumption.rs`, boolean std fns |
| Cache interaction | `rust/kcl-lib/src/execution/cache.rs` |
| Docs | `docs/kcl-std/`, `docs/kcl-lang/` |
| Tests | `rust/kcl-lib/tests/...` |

Artifact graph / selection UI intentionally **not** in the v1 checklist.

---

## 10. Resolved decisions (from review)

| # | Topic | Decision |
|---|--------|----------|
| — | API | `setProperties(@solid, label, properties)` — required string `label`, free-form `properties` |
| 4 | Schema | Free-form map; **no** forced keys inside properties; `label` is the one forced, separate kwarg |
| 5 | Collect | **`bom()` only** — no required solids list; explicit list would defeat the purpose |
| 6 | Discovery | Dedicated **ExecState registry** (details in §11) |
| 2 | Merge | Replace properties map on each set (accepted lean) |
| 3 | Value types | string / number / bool / nested plain objects; no geometry (accepted lean) |
| 7 | Unlabeled | Omit from `bom()` (accepted lean) |
| 8 | hide/delete | hide stays in BOM; delete out (accepted lean) |
| 9 | Booleans | **Drop** properties (consistently); **warning**, not error |
| 10 | split | Drop (accepted lean) |
| 11 | fillet/chamfer | Preserve (accepted lean) |
| 12 | Pattern array | Per-source copy (accepted lean) |
| 14 | Sketches | Solids-only v1 (accepted lean) |
| 15 | Length sync | Honor system; later optional measure tools to *populate* properties |
| 16 | Units | Canonical-unit equality in grouping (accepted lean) |
| 17 | Grouping | Centered on **`label`**; then properties distinguish cuts within a label |
| 18 | Engine | KCL / ExecState only for v1 (accepted lean) |
| 19 | Artifact graph | **Out of scope** for v1 — no |
| 21 | Imports | Defer `ImportedGeometry` initially |
| 22 | Naming collect | Start with **`bom`** / `groupBom`; add **`cutList`** helper later from BOM |
| 23 | Naming set | `setProperties` (accepted lean); avoid `attributes` clash with `@attributes` |
| 1 | Namespace | Solid-adjacent helpers + `bom` / `groupBom` (accepted lean) |

---

## 11. Remaining open questions — accepted as leans

All items below were accepted as written (2026-07-25). Treat them as locked defaults; only reopen if implementation discovers a contradiction (especially cache / `useOriginal`).

### Registry mechanics

1. **Registry key:** key by `artifact_id`; transforms upsert; clone/pattern/mirror insert new rows.
2. **Registry payload:** store a **copy** of `{ label, properties }`; stdlib is the only writer of Solid + registry together.
3. **Who writes:** **stdlib-only** via a helper like `exec_state.bom_register(...)`.
4. **Caching:** BOM registry is `ExecState` data **snapshotted/restored with the cache**; verify/implement in Phase 1 against `cache.rs` — do not ship global `bom()` without this.

### Label + API details

5. **Storage:** sibling `label: Option<String>` + `properties` map on `Solid`.
6. **`getProperties`:** returns `{ label, properties }`; error if unset.
7. **Re-set:** allowed — replace label + map, upsert registry.
8. **`clearProperties`:** clears label + map and unregisters.

### Grouping

9. **`groupBom`:** group by **label + properties equality** (canonical units).
10. **Shapes:** `bom()` entries match `groupBom` input: `[{ label, properties }]`.

### Booleans / warnings

11. **`subtract`:** **preserve** on kept solid; no warning.
12. **Warnings** (union/intersect/split drop): first-class execution warnings in the problems UI.

### Pattern edge case

13. **`useOriginal`:** no special case until inspection says otherwise — copy from the solid actually patterned.

### Optional sugar

14. **`bom(label = …)`:** defer; filter in userland for now.
15. **Module path:** `std::solid`, prelude-export like `appearance`.

---

## 12. Ready to implement / smoke test

| Phase | Smoke-testable? | What to try |
|-------|-----------------|-------------|
| **2 (done)** | **Yes — first slice** | In Design Studio: create a solid, `setProperties`, `getProperties`, `clearProperties`, translate and re-get |
| 3 | Partially | Clone/pattern a labeled stud; properties should appear on copies (still no `bom()`) |
| **4** | **Yes — full cut-list** | End-of-file `bom()` / `groupBom()` after a parametric pattern |
| 5 | Docs / UI polish | Samples, optional panel |

**Suggested start order remaining:** Phase 3 → 4 → 5.
