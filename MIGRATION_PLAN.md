# Migration Plan: Moving Trim Tests from TypeScript to Rust

## Overview

This document outlines the plan to migrate trim tool tests from TypeScript (`src/machines/sketchSolve/tools/trimToolImpl.spec.ts`) to Rust, and refactor the trim implementation to live primarily in `kcl-lib` rather than `kcl-wasm-lib`.

## Current State

### TypeScript Tests
- **Location**: `src/machines/sketchSolve/tools/trimToolImpl.spec.ts`
- **Test Pattern**: 
  ```typescript
  {
    initialCode: string,      // KCL code string
    trimPoints: Coords2d[],   // Array of [x, y] coordinates
    expectedCode: string      // Expected KCL code after trim
  }
  ```
- **Test Count**: ~30 test cases covering:
  - Basic line/line and arc/arc intersections (4 cases each)
  - Split trims
  - Multi-segment trims
  - Constraint migration (coincident, distance, angle, horizontal, vertical, perpendicular)
  - Edge cases with point-segment coincident constraints
  - Stress tests

### Rust Implementation
- **Location**: `rust/kcl-wasm-lib/src/trim.rs` (~3400 lines)
- **Functions to Move**:
  - `get_next_trim_coords` - finds next trim spawn
  - `get_trim_spawn_terminations` - finds termination points
  - `trim_strategy` - determines trim operations
  - Helper functions: geometric calculations, position extraction, etc.
- **WASM Entry Point**: `execute_trim` in `rust/kcl-wasm-lib/src/api.rs`

### Dependencies
- `kcl-wasm-lib` depends on `kcl-lib` (already has access)
- `kcl-lib` is a pure Rust library (no WASM dependencies)
- Tests in `kcl-lib` can use `ExecutorContext` and `FrontendState` directly

## Goals

- [ ] Move core trim logic from `kcl-wasm-lib` to `kcl-lib` so it can be tested without WASM
- [ ] Keep thin WASM wrappers in `kcl-wasm-lib` that call into `kcl-lib`
- [ ] Migrate all TypeScript tests to Rust
- [ ] Maintain backward compatibility with existing TypeScript/WASM code

## Migration Plan

### Phase 1: Create Trim Module in kcl-lib

**Status**: [x] **COMPLETE** - File moved and WASM code removed, compiles successfully

**File**: `rust/kcl-lib/src/frontend/trim.rs` (new file)

**Note**: `frontend.rs` is the main file that declares submodules from the `frontend/` directory:
- `rust/kcl-lib/src/frontend.rs` - declares modules
- `rust/kcl-lib/src/frontend/api.rs` - submodule
- `rust/kcl-lib/src/frontend/trim.rs` - new submodule (to be created)

**Strategy**: Use `git` commands to preserve history and ensure implementations remain unchanged.

**Steps**:
- [x] Copy the entire file to preserve original (using git-friendly approach):
  ```bash
  # Copy the file to new location
  cp rust/kcl-wasm-lib/src/trim.rs rust/kcl-lib/src/frontend/trim.rs
  
  # Add it to git (this preserves history if we use --follow later)
  git add rust/kcl-lib/src/frontend/trim.rs
  ```
- [x] Add module declaration to `rust/kcl-lib/src/frontend.rs`:
  ```rust
  pub(crate) mod trim;
  ```
- [x] Now modify `rust/kcl-lib/src/frontend/trim.rs` to remove WASM-specific code:
  - [x] `Coords2d` struct (remove WASM-specific serde, keep basic struct)
  - [x] `NextTrimResult` enum (removed WASM serde)
  - [x] `TrimTermination` enum (removed WASM serde)
  - [x] `TrimTerminations` struct (removed WASM serde)
  - [x] `TrimOperation` enum (removed WASM serde)
  - [x] `ConstraintToMigrate` struct (kept, no WASM code)
  - [x] All geometric helper functions (no `#[wasm_bindgen]` attributes):
    - [x] `is_point_on_line_segment`
    - [x] `line_segment_intersection`
    - [x] `project_point_onto_segment`
    - [x] `perpendicular_distance_to_segment`
    - [x] `is_point_on_arc`
    - [x] `line_arc_intersection`
    - [x] `project_point_onto_arc`
    - [x] `arc_arc_intersection`
    - [x] `get_position_coords_for_line`
    - [x] `get_position_coords_from_arc`
  - [x] Core trim functions:
    - [x] `get_next_trim_coords`
    - [x] `get_trim_spawn_terminations`
    - [x] `trim_strategy`
    - [x] All helper functions used by these
- [x] Remove WASM-specific code from `rust/kcl-lib/src/frontend/trim.rs`:
  - [x] Remove `#[cfg(target_arch = "wasm32")]` imports (gloo_utils, wasm_bindgen)
  - [x] Remove `#[cfg(target_arch = "wasm32")]` serde Serialize/Deserialize impls for Coords2d
  - [x] Remove `#[cfg(target_arch = "wasm32")]` serde Serialize impls for NextTrimResult, TrimTermination, etc.
  - [x] Remove `#[wasm_bindgen]` attributes from all functions
  - [x] Change `#[cfg(any(target_arch = "wasm32", test))]` to just `pub` (remove cfg entirely)
  - [x] Remove `TrimLoopInput`, `TrimLoopOutput` structs (WASM-only)
  - [x] Remove `process_trim_loop` WASM function (keep in kcl-wasm-lib)
  - [x] Keep `Coords2d` struct but remove serde impls
  - [x] Keep all core types and functions (NextTrimResult, TrimTermination, etc.) but remove WASM serde
- [x] Update imports to use `crate::frontend::*` types directly
- [x] Make functions `pub` (not `pub(crate)`) so they can be used by kcl-wasm-lib
- [x] Verify `rust/kcl-lib/src/frontend/trim.rs` compiles:
  ```bash
  cd rust/kcl-lib
  cargo check
  ```
  ✅ **Result**: Compiles successfully with 31 warnings (mostly unused imports/variables, can be cleaned up later)

**Module Declaration**:
Add to `rust/kcl-lib/src/frontend.rs` (frontend is a single file, not a directory):
```rust
pub(crate) mod trim;
```

Or if trim is large enough, create `rust/kcl-lib/src/frontend/trim/mod.rs` and add:
```rust
pub(crate) mod trim;
```

### Phase 2: Update kcl-wasm-lib to Use kcl-lib Functions

**Status**: [ ] Not Started

**File**: `rust/kcl-wasm-lib/src/trim.rs`

**Strategy**: Keep WASM-specific code in kcl-wasm-lib, re-export core functions from kcl-lib.

**Steps**:
- [ ] Modify `rust/kcl-wasm-lib/src/trim.rs` to re-export from kcl-lib:
  - [ ] Add imports from `kcl_lib::frontend::trim`
  - [ ] Keep WASM-specific types and serialization:
    - [ ] `Coords2d` with serde Serialize/Deserialize for WASM (or create wrapper)
    - [ ] `TrimLoopInput` and `TrimLoopOutput` structs (keep these)
    - [ ] `process_trim_loop` WASM function (keep this)
- [ ] Create conversion functions between WASM `Coords2d` and core `Coords2d`:
  ```rust
  pub use kcl_lib::front::trim::{
      Coords2d as Coords2dCore,  // Or create conversion functions
      get_next_trim_coords,
      get_trim_spawn_terminations,
      trim_strategy,
      // ... etc
  };
  ```
- [ ] Create conversion functions between WASM `Coords2d` and core `Coords2d`:
  ```rust
  impl From<kcl_lib::front::trim::Coords2d> for Coords2d {
      fn from(c: kcl_lib::front::trim::Coords2d) -> Self {
          Coords2d { x: c.x, y: c.y }
      }
  }
  ```
- [ ] Update `execute_trim` in `api.rs` to use `kcl_lib::frontend::trim::*` functions:
  - [ ] Change imports from `crate::trim::*` to `kcl_lib::frontend::trim::*`
  - [ ] Update function calls to use kcl-lib versions
  - [ ] Convert between WASM Coords2d and kcl-lib Coords2d as needed
- [ ] Keep `process_trim_loop` WASM function in `trim.rs` for backward compatibility (if needed)
- [ ] Verify WASM bindings still compile:
  ```bash
  cd rust/kcl-wasm-lib
  cargo check --target wasm32-unknown-unknown
  ```
- [ ] Test that existing TypeScript code still works (run TypeScript tests)

### Phase 3: Create Test Infrastructure in kcl-lib

**Status**: [x] In Progress

**File**: `rust/kcl-lib/src/frontend/trim/tests.rs` (new file)

**Alternative**: Use inline tests with `#[cfg(test)] mod tests { ... }` in `trim.rs` if tests are small.

**Following kcl-lib patterns**: Tests in kcl-lib use:
- `#[tokio::test(flavor = "multi_thread")]` for async tests
- `pretty_assertions::assert_eq!` for better error messages
- Helper functions in test modules

**Steps**:
- [ ] Create test file (either `trim/tests.rs` or inline `#[cfg(test)] mod tests`)
- [ ] Create test helper function to execute trim flow:
   ```rust
   async fn execute_trim_flow(
       kcl_code: &str,
       trim_points: &[(f64, f64)],
       sketch_id: ObjectId,
   ) -> Result<String, String> {
       // 1. Parse KCL code
       // 2. Create ExecutorContext
       // 3. Create FrontendState
       // 4. Execute initial code to get scene graph
       // 5. Run trim operations using kcl_lib::front::trim functions
       // 6. Return resulting KCL code
   }
   ```

- [x] Implement `execute_trim_flow` helper function:
  - [x] Parse KCL code
  - [x] Create ExecutorContext
  - [x] Create FrontendState
  - [x] Execute initial code to get scene graph
  - [x] Run trim operations using kcl_lib::front::trim functions
  - [x] Return resulting KCL code
- [x] Use existing test infrastructure:
  - [x] `ExecutorContext` from `kcl_lib::execution`
  - [x] `FrontendState` from `kcl_lib::frontend`
  - [x] `hack_set_program` to get initial scene graph
  - [x] `delete_objects`, `edit_segments` for executing trim operations
  - [ ] `add_constraint` for executing trim operations (AddCoincidentConstraint not yet implemented)
- [x] Create KCL code normalization helper for test comparisons
- [x] Write a simple test to verify infrastructure works

**Test Structure**:
```rust
#[tokio::test]
async fn test_arc_line_trim_with_existing_point_segment_coincident() {
    let initial_code = r#"
@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc1 = sketch2::arc(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm], center = [var 30mm, var 0mm])
  line1 = sketch2::line(start = [var -5mm, var -2mm], end = [var -0.41mm, var -0.17mm])
  sketch2::coincident([line1.end, arc1])
}
"#;
    
    let trim_points = vec![(-2.0, 2.0), (2.0, 2.0)];
    
    let expected_code = r#"
@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc1 = sketch2::arc(start = [var -0.41mm, var -0.17mm], end = [var 0mm, var -5mm], center = [var 30mm, var -0mm])
  line1 = sketch2::line(start = [var -5mm, var -2mm], end = [var -0.41mm, var -0.17mm])
  sketch2::coincident([arc1.start, line1.end])
}
"#;
    
    let result = execute_trim_flow(initial_code, &trim_points, ObjectId(0)).await?;
    assert_eq!(result.trim(), expected_code.trim());
}
```

### Phase 4: Migrate Individual Test Cases

**Status**: [ ] Not Started

**Approach**: Migrate tests in groups by category:

1. **Basic Intersection Tests** (8 tests)
   - [ ] `All 4 trims on a basic line line intersection` (4 tests)
     - [ ] Case 1: trim line2 from [-2, -2] to [-2, 2] - should trim left side (start)
     - [ ] Case 2: trim line2 from [2, -2] to [2, 2] - should trim right side (end)
     - [ ] Case 3: trim line1 from [-2, 2] to [2, 2] - should trim bottom (end)
     - [ ] Case 4: trim line1 from [-2, -2] to [2, -2] - should trim top (start)
   - [ ] `All 4 trims on a basic arc arc intersection` (4 tests)
     - [ ] Case 1: trim arc2 from [-2, -2] to [-2, 2] - should trim left side (start)
     - [ ] Case 2: trim arc2 from [2, -2] to [2, 2] - should trim right side (end)
     - [ ] Case 3: trim arc1 from [-2, 2] to [2, 2] - should trim bottom (end)
     - [ ] Case 4: trim arc1 from [-2, -2] to [2, -2] - should trim top (start)

2. **Split Trim Tests** (1 test)
   - [ ] `Split trim - line trimmed between two intersections`

3. **Multi-segment Trim Tests** (6 tests)
   - [ ] should delete both segments when a single section of the trim line intersects two segments
   - [ ] Should remove coincident point from the end of a segment's end that is being trimmed
   - [ ] split trim where the end of the trimed segment has a point-line coincident constraint
   - [ ] another edge case involving split lines and point-segment coincident points
   - [ ] Can split arc with point-segment coincident constraints
   - [ ] split arc with point-segment coincident on one side and intersection on the other

4. **Constraint Migration Tests** (8 tests)
   - [ ] split straight segments should migrate other constraints correctly
   - [ ] trim with distance constraints should preserve constraints correctly
   - [ ] split trim should migrate angle constraints to new segment
   - [ ] split trim should migrate horizontal constraint to new segment
   - [ ] split trim should migrate vertical constraint to new segment
   - [ ] split trim should migrate perpendicular constraint to new segment
   - [ ] split arc should duplicate center point constraints to new arc
   - [ ] Trimming arcs should preserve distance constraints that reference other segments

5. **Edge Case Tests** (4 tests)
   - [ ] Arc-line trim with existing point-segment coincident
   - [ ] getTrimSpawnTerminations tests (4 sub-tests for lines, 4 for arcs)
     - [ ] finds terminations correctly when a line and arc intersect (line)
     - [ ] finds "segEndPoint" terminations (line)
     - [ ] finds "trimSpawnSegmentCoincidentWithAnotherSegmentPoint" terminations (line)
     - [ ] finds 'segEndPoint' terminations when there's other segments who have ends on our segment line (line)
     - [ ] finds terminations correctly when a line and arc intersect (arc)
     - [ ] finds "segEndPoint" terminations (arc)
     - [ ] finds "trimSpawnSegmentCoincidentWithAnotherSegmentPoint" terminations (arc)
     - [ ] finds 'segEndPoint' terminations when there's other segments who have ends on our segment line (arc)

6. **Stress Test** (1 test)
   - [ ] stress test: complex trim line through many segments

**For each test**:
- [ ] Convert TypeScript test to Rust test
- [ ] Use `execute_trim_flow` helper
- [ ] Normalize KCL code comparison (whitespace, formatting)
- [ ] Handle floating-point precision in coordinate comparisons
- [ ] Verify test passes

### Phase 5: Update TypeScript Tests (Optional)

**Status**: [ ] Not Started

**Decision Point**: Keep TypeScript tests as integration tests or remove them?

**Option A**: Keep as integration tests
- [ ] Keep a few high-level integration tests in TypeScript
- [ ] These test the full WASM boundary
- [ ] Remove detailed unit tests

**Option B**: Remove all TypeScript tests
- [ ] All tests move to Rust
- [ ] TypeScript code only has type definitions

**Recommendation**: Option A - Keep 2-3 critical integration tests to ensure WASM boundary works correctly.

**Decision**: [ ] Option A [ ] Option B

### Phase 6: Cleanup

**Status**: [ ] Not Started

- [ ] Remove unused TypeScript test code
- [ ] Update documentation
- [ ] Verify all tests pass
  - [ ] All Rust tests pass
  - [ ] Remaining TypeScript integration tests pass (if any)
- [ ] Check that WASM bindings still work in browser
- [ ] Run full test suite to ensure no regressions
- [ ] Update any related documentation or comments

## Implementation Details

### Git History Preservation Strategy

Since we're splitting one file (`trim.rs`) into two locations, we'll use this approach:

1. **Copy the file** (preserves content, git will track it):
   ```bash
   cp rust/kcl-wasm-lib/src/trim.rs rust/kcl-lib/src/frontend/trim.rs
   git add rust/kcl-lib/src/frontend/trim.rs
   ```

2. **Modify both files**:
   - `rust/kcl-lib/src/frontend/trim.rs`: Remove WASM-specific code
   - `rust/kcl-wasm-lib/src/trim.rs`: Keep WASM code, re-export from kcl-lib

3. **Git will track both files** separately, and we can use `git log --follow` to see history if needed.

**Alternative**: If you want to preserve more git history, you could:
```bash
# Move the file (git tracks the move)
git mv rust/kcl-wasm-lib/src/trim.rs rust/kcl-lib/src/frontend/trim.rs

# Then copy it back to kcl-wasm-lib
cp rust/kcl-lib/src/frontend/trim.rs rust/kcl-wasm-lib/src/trim.rs
git add rust/kcl-wasm-lib/src/trim.rs
```

This way git knows they're related, but you'll have two separate files to modify.

### File Structure After Migration

```
rust/kcl-lib/src/
  ├── frontend.rs          # Add: pub(crate) mod trim;
  └── frontend/
      ├── trim.rs          # Core trim logic (moved from kcl-wasm-lib)
      └── trim/
          └── tests.rs     # Trim tests (or #[cfg(test)] mod tests in trim.rs)

rust/kcl-wasm-lib/src/
  ├── trim.rs              # WASM wrappers and serialization
  └── api.rs               # execute_trim (uses kcl-lib functions)
```

**Note**: Following kcl-lib patterns, tests can be:
- Inline with `#[cfg(test)] mod tests { ... }` in `trim.rs`
- Or in a separate `trim/tests.rs` file if the test module is large

### Key Functions to Move

**From `kcl-wasm-lib/src/trim.rs` to `kcl-lib/src/frontend/trim.rs`**:

1. **Types** (remove WASM-specific code):
   - `Coords2d` (basic struct, no serde)
   - `NextTrimResult`
   - `TrimTermination`
   - `TrimTerminations`
   - `TrimOperation`
   - `ConstraintToMigrate`

2. **Geometric Functions**:
   - `is_point_on_line_segment`
   - `line_segment_intersection`
   - `project_point_onto_segment`
   - `perpendicular_distance_to_segment`
   - `is_point_on_arc`
   - `line_arc_intersection`
   - `project_point_onto_arc`
   - `arc_arc_intersection`

3. **Position Extraction**:
   - `get_position_coords_for_line`
   - `get_position_coords_from_arc`

4. **Core Trim Logic**:
   - `get_next_trim_coords`
   - `get_trim_spawn_terminations`
   - `trim_strategy`
   - All helper functions used by these

### Test Helper Function Implementation

The `execute_trim_flow` function needs to:

1. **Parse KCL**:
   ```rust
   use kcl_lib::parsing::parser::parse;
   let ast = parse(kcl_code)?;
   ```

2. **Create Executor Context**:
   ```rust
   use kcl_lib::execution::ExecutorContext;
   let ctx = ExecutorContext::new(...);
   ```

3. **Create Frontend State**:
   ```rust
   use kcl_lib::frontend::FrontendState;
   let mut frontend = FrontendState::new();
   frontend.set_program(ast);
   ```

4. **Get Initial Scene Graph**:
   ```rust
   let (_, scene_graph_delta) = frontend
       .execute_mock(&ctx, Version(0), sketch_id)
       .await?;
   ```

5. **Run Trim Loop** (similar to `execute_trim` in api.rs):
   ```rust
   use kcl_lib::frontend::trim::*;
   
   let mut current_scene_graph_delta = scene_graph_delta;
   let mut start_index = 0;
   
   while start_index < trim_points.len() - 1 {
       let next_trim_result = get_next_trim_coords(
           &trim_points,
           start_index,
           &current_scene_graph_delta.new_graph.objects,
       );
       
       match next_trim_result {
           NextTrimResult::TrimSpawn { ... } => {
               // Get terminations, strategy, execute operations
           }
           NextTrimResult::NoTrimSpawn { next_index } => {
               start_index = next_index;
           }
       }
   }
   ```

6. **Return Final KCL Code**:
   ```rust
   let final_source = frontend.program.source();
   Ok(final_source)
   ```

### Handling KCL Code Comparison

KCL code formatting may differ slightly. Options:

1. **Normalize whitespace**: Trim and normalize newlines
2. **Parse and compare ASTs**: More robust but more complex
3. **Use fuzzy matching**: Allow small differences in formatting

**Recommendation**: Start with whitespace normalization, add AST comparison if needed.

## Testing Strategy

### Unit Tests (in kcl-lib)
- Test individual trim functions with mock data
- Test geometric calculations
- Test termination finding logic

### Integration Tests (in kcl-lib)
- Test full trim flow with real KCL code
- Test constraint migration
- Test edge cases

### WASM Integration Tests (in kcl-wasm-lib or TypeScript)
- Test WASM boundary
- Test serialization/deserialization
- Test browser compatibility

## Risks and Mitigation

### Risk 1: Breaking WASM Bindings
- **Mitigation**: Keep WASM wrappers in kcl-wasm-lib, test them separately
- **Verification**: Run existing TypeScript integration tests

### Risk 2: Test Failures Due to Precision
- **Mitigation**: Use approximate equality for floating-point comparisons
- **Approach**: Normalize KCL output before comparison

### Risk 3: Performance Regression
- **Mitigation**: Benchmark before and after migration
- **Note**: Moving to kcl-lib should improve performance (no WASM overhead in tests)

### Risk 4: Large Refactor Complexity
- **Mitigation**: 
  - Do migration in phases
  - Keep old code until new code is verified
  - Test incrementally

## Success Criteria

- [ ] All trim logic lives in `kcl-lib/src/frontend/trim.rs`
- [ ] All tests migrated from TypeScript to Rust
- [ ] WASM bindings still work (verified by integration tests)
- [ ] All tests pass
- [ ] No performance regression
- [ ] Code is cleaner and more maintainable

## Timeline Estimate

- **Phase 1**: 2-3 days (move code to kcl-lib)
- **Phase 2**: 1-2 days (update kcl-wasm-lib)
- **Phase 3**: 2-3 days (create test infrastructure)
- **Phase 4**: 3-5 days (migrate all tests)
- **Phase 5**: 1 day (update/remove TypeScript tests)
- **Phase 6**: 1 day (cleanup)

**Total**: ~10-15 days

## Next Steps

- [ ] Review and approve this plan
- [ ] Start with Phase 1 (move code to kcl-lib)
- [ ] Verify Phase 1 works before proceeding
- [ ] Iterate through remaining phases

## Progress Summary

**Overall Progress**: ~30% (Phases 1 & 2 complete, ready for Phase 3)

- Phase 1: [x] **COMPLETE** (File moved, WASM code removed, compiles successfully)
- Phase 2: [x] **COMPLETE** (kcl-wasm-lib updated to use kcl-lib, compiles successfully)
- Phase 2: [ ] 0% (0/7 tasks)
- Phase 3: [ ] 0% (0/6 tasks)
- Phase 4: [ ] 0% (0/~30 tests)
- Phase 5: [ ] 0% (decision pending)
- Phase 6: [ ] 0% (0/6 tasks)

### File Move Status ✅

**Completed**:
- ✅ Copied `rust/kcl-wasm-lib/src/trim.rs` → `rust/kcl-lib/src/frontend/trim.rs` (4101 lines, identical)
- ✅ Added module declaration `pub(crate) mod trim;` to `rust/kcl-lib/src/frontend.rs`
- ✅ Both files added to git staging

**Files are now ready for code modifications** (removing WASM-specific code from kcl-lib version).
