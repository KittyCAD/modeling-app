These are principles we try to follow as a team working on this product. Anyone can suggest additions or edits. 

## 0. Application architecture
1. Use React as a thin view layer unless absolutely necessary, presenting state that is defined outside of React.

2. Reduce the usage of the global `initPromise()` workflow of globally importing and initializing the WASM instance.

3. Reduce the usage of circular dependencies in src/lib/singletons.ts.

4. Make functions and react components take references to singletons to enable unit testing instead of globally importing a singleton.

5. Know the life cycle of the data you are working with 
  1. How does it get populated?
  2. Does it get stale?
  3. Does it need to exist across the entire application?
  4. Does it need to live within the mount/unmount of a React component?
  5. Does it need to live in React?
  6. Does it need to live in Javascript memory?
  7. When it is available?
  8. Does code depend on it? 
  9. Where it is populated from?
    1. User input
    2. HTTP request
    3. Websocket request
    4. WASM instance
    5. File system (off disk)

## 1. UX design
1. Animate sparingly
2. Keep distractions from the scene at a minimum
