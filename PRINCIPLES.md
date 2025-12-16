These are principles we try to follow as a team working on this product. Anyone can suggest additions or edits. 

## 0. Application architecture
1. Use React as a thin view layer unless absolutely necessary, presenting state that is defined outside of React.

2. Reduce the usage of the global `initPromise()` workflow of globally importing and initializing the WASM instance.

3. Reduce the usage of circular dependencies in src/lib/singletons.ts.

4. Make functions and react components take references to singletons to enable unit testing instead of globally importing a singleton.

5. Know and document the life cycle of the data you are working with 
    - How does data get populated?
    - Does data get stale?
    - Does data need to exist across the entire application?
    - Does data need to live within the mount/unmount of a React component?
    - Does data need to live in React?
    - Does data need to live in Javascript memory?
    - When is the data available?
    - Does code depend on data that is async? 
    - Where is the data populated from?
      - User input
      - HTTP request
      - Websocket request
      - WASM instance
      - File system (off disk)

## 1. UX design
1. Animate sparingly
2. Keep distractions from the scene at a minimum

## 2. Modeling Codemods, Command Palette, and Testing
1. Codemods are defined in `src/lang/modifyAst/*.ts` and grouped by categories
  a. They take in an AST with all the command arguments, clone it, and return it modified
  b. They are generally scoped to the creation of one KCL stdlib function call, yielding one operation in the Feature Tree
  c. They are also capable of editing an existing call, in which case they take a `nodeToEdit` path to node
  d. Edits are called from the `src/lib/operations.ts` file, in which `prepareToEdit*` functions live, and are responsible of massaging all the operation data back into command-palette-compatible args, just like at create time.
2. Codemods are tested at the integration level, in vitest spec files at `src/lang/modifyAst/*.spec.ts`, also grouped by categories
  a. Some of these tests need an engine connection (eg. to check on face or edge-cut artifacts), some don't
  b. This is the perfect place to run all argument permutation testing
  c. A few e2e playwright test exist today, generally one per command, to test the integration of codemods withing `modelingMachine`, the Command Palette, the edit flows, etc.
3. A systematic approach for codemods to handle the creation of standalone KCL statements vs pipe expressions is outlined in the following diagram.