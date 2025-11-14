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
