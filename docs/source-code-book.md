# Zoo Design Studio: Source Code Book

This book explains the app using plain words.

Each passage is short.

Passage rule used here: 30 words or fewer.

That is about 10 seconds at normal reading speed.

## 1. What This Project Is

- Zoo Design Studio is a CAD app.
- It mixes code modeling and point-and-click modeling.
- Models are represented as KCL code.
- The app can run in a browser.
- The app can also run as a desktop Electron app.
- The desktop app supports local files and OS menus.
- The browser version uses a temporary local project.

## 2. Main Technology Stack

- The UI is built with React.
- State machines are built with XState.
- The code editor is CodeMirror 6.
- The 3D helper scene uses Three.js.
- The engine connection uses WebSocket and WebRTC.
- KCL tooling comes from Rust, compiled to WASM.
- The project uses Vite for builds.
- Tests use Vitest and Playwright.

## 3. Runtime Targets

- Web mode uses browser storage and browser routing.
- Desktop mode uses Electron, preload bridges, and Node APIs.
- Desktop routes use hash routing.
- Web routes use browser history routing.
- Desktop mode supports auto-update notifications.
- Desktop mode supports native menus and file associations.
- Both modes share most modeling logic.

## 4. Boot Sequence

- `src/index.tsx` starts the app.
- It selects the filesystem backend first.
- It creates and provides one global `App` instance.
- It waits for WASM setup before starting the app actor.
- It registers command groups after WASM is ready.
- It mounts React providers and the router.
- It also installs global error handling.

## 5. Global Services Built by `App`

- `App` builds core singletons once.
- It creates `ConnectionManager` for engine networking.
- It creates `RustContext` for Rust-side workflows.
- It creates `SceneInfra` for camera and interaction infrastructure.
- It creates `KclManager` for code, AST, execution, and diagnostics.
- It creates `SceneEntities` for sketch overlays and handles.
- It starts settings, auth, billing, and command bar actors.
- It spawns one system IO actor.

## 6. Main Pages and Route Shape

- `/home` shows project browsing.
- `/file/:id` opens the modeling workspace.
- `/signin` handles authentication flow.
- `/settings` opens the settings dialog route.
- `/telemetry` opens telemetry details.
- On web, root redirects to a browser project file.
- On desktop, root redirects to home.

## 7. Workspace Layout Model

- Layout is data, not hardcoded DOM only.
- Default layout has left, center, and right areas.
- Center is the modeling scene.
- Left panes include feature tree and code.
- Left panes also include files, variables, and logs.
- Right pane hosts the Zookeeper chat area.
- Pane visibility is toggled by layout actions.

## 8. Modeling State Machine

- `modelingMachine` is the core interaction machine.
- It handles modeling mode and sketch mode transitions.
- It handles tool changes and sketch workflows.
- It handles constraints and geometry operations.
- It handles export, boolean ops, and transforms.
- It receives selection events from engine picks.
- It updates state based on AST and scene outcomes.

## 9. KCL Core Loop

- `KclManager` holds code, AST, exec state, and diagnostics.
- It parses code using Rust WASM bindings.
- It can recast AST back to source code.
- It executes AST against the modeling engine.
- It updates editor diagnostics and operation metadata.
- It writes code to disk when needed.
- It tracks undo and redo depth.
- It keeps a last successful state for resilience.

## 10. Artifact Graph Purpose

- Artifact graph maps engine geometry IDs to code context.
- It lets clicks on geometry map back to AST ranges.
- It powers code highlight from scene hover events.
- It powers feature edits based on scene selections.
- It supports complex links like face-to-extrude-to-sketch.
- It is updated from execution results.

## 11. Scene Infrastructure

- `SceneInfra` owns camera, renderer, raycaster, and callbacks.
- It stores interaction callbacks for move, click, and drag.
- It scales scene units based on model base unit.
- It emits segment overlay payload updates.
- It synchronizes camera controls with app state.
- It resets listeners when modes change.

## 12. Scene Entities Layer

- `SceneEntities` builds interactive sketch visuals.
- It manages draft points and segment handles.
- It updates overlays as camera changes.
- It creates and positions sketch planes.
- It applies AST updates for sketch actions.
- It uses mock execution during sketch editing paths.

## 13. Engine Networking

- `ConnectionManager` orchestrates engine communication.
- It starts with a WebSocket handshake.
- It then negotiates a WebRTC peer connection.
- Commands and events use reliable and unreliable channels.
- It tracks pending commands and response mapping.
- It exposes subscriptions for engine events.
- It dispatches connection state events to UI hooks.

## 14. Stream Rendering Path

- The modeling scene includes a streamed video element.
- Server-rendered engine frames appear in that stream.
- A client-side Three.js overlay handles local sketch UX.
- Click and hover events are sent back to engine.
- Reconnect logic handles offline and close events.
- Resize logic updates stream dimensions.

## 15. Filesystem and Project Handling

- `fs-zds` gives one filesystem interface for all targets.
- Backends include `electronfs`, `nodefs`, and `noopfs`.
- System IO machine handles project and file operations.
- It handles create, rename, delete, and navigation events.
- It supports bulk file workflows for generated content.
- Desktop mode reads real directories.
- Web mode writes into browser-managed storage patterns.

## 16. Route Loaders and File Open Flow

- File loader resolves project path from route ID.
- It reads file content and normalizes line endings.
- It updates `KclManager` with the open file path.
- It loads project settings after project open.
- It sends open-project context into `RustContext`.
- Home loader clears current project settings context.

## 17. Command System

- Command bar is an XState machine.
- Commands are grouped by domain, like code or modeling.
- Commands can require argument review before submit.
- Commands can validate argument values.
- Commands can be added and removed at runtime.
- Modeling page registers route and modeling commands dynamically.

## 18. Settings System

- Settings use a `Setting<T>` class.
- Values can exist at default, user, and project levels.
- Current value resolves with project overriding user.
- Settings machine persists settings asynchronously.
- It can load user settings and project settings.
- It can register settings commands into command bar.
- Main categories are app, modeling, textEditor, projects, commandBar, and meta.

## 19. Authentication and Billing

- Auth is an XState machine with login states.
- It supports token from env, cookie, or desktop file.
- Desktop login supports device flow via Electron IPC.
- Auth machine loads user profile when token is valid.
- Billing machine fetches credit and subscription data.
- Billing updates are rate-limited on the client.

## 20. AI Assistant Layer

- Zookeeper integration uses `mlEphantManagerMachine`.
- It tracks conversations as exchanges of requests and responses.
- It handles websocket messaging and stream responses.
- It tracks abrupt close and backend shutdown states.
- Conversation IDs can be stored per project.
- Desktop system IO stores conversation mapping metadata.

## 21. LSP and Editor Intelligence

- `LspProvider` starts two language workers.
- One worker runs KCL LSP services.
- One worker runs copilot/autocomplete services.
- Both workers load Rust WASM LSP entry points.
- LSP plugins are injected into CodeMirror compartments.
- File open and close events are sent to LSP clients.

## 22. Rust Workspace Map

- Rust workspace includes multiple crates.
- `kcl-lib` is the core KCL compiler and tooling crate.
- `kcl-wasm-lib` exposes WASM bindings to TypeScript.
- `kcl-language-server` provides LSP server implementation.
- `kcl-python-bindings` exposes KCL bindings to Python.
- `kcl-test-server` supports test-oriented workflows.

## 23. What Rust WASM Exposes

- Parsing and recasting KCL source.
- Lint execution and diagnostics support.
- Node-path lookup from source ranges.
- Number and unit formatting helpers.
- App and project settings parse and serialize helpers.
- Frontend lifecycle APIs for sketch workflows.
- LSP server entry points for KCL and Copilot.

## 24. KCL Documentation in This Repo

- `docs/kcl-lang` contains language reference pages.
- `docs/kcl-std` contains standard library pages.
- Standard library docs list functions, constants, and types.
- Language docs cover modules, functions, pipelines, and settings.
- These docs are generated from Rust-side definitions and tooling.

## 25. Testing Strategy

- Unit tests use `*.test.*` patterns in `src`.
- Integration tests use `*.spec.*` patterns in `src`.
- Vitest uses separate unit and integration projects.
- E2E tests live under `e2e/playwright`.
- Web and desktop have separate Playwright configs.
- Snapshot and regression suites are included.

## 26. Build and Release Flow

- App uses npm scripts for common workflows.
- WASM build scripts compile Rust into browser artifacts.
- Desktop build uses Electron builder config.
- Output artifacts cover macOS, Windows, and Linux.
- `.kcl` file associations are configured for desktop installers.
- Auto-update channel is configured in release metadata.

## 27. Practical Mental Model

- Think of the app as five connected layers.
- Layer one is UI and route structure.
- Layer two is XState actors and state orchestration.
- Layer three is KCL manager and AST transformations.
- Layer four is engine networking and stream transport.
- Layer five is Rust KCL compiler, executor, and LSP logic.

## 28. Source Map for This Book

- `README.md`
- `package.json`
- `src/index.tsx`
- `src/lib/app.ts`
- `src/Router.tsx`
- `src/machines/modelingMachine.ts`
- `src/lang/KclManager.ts`
- `src/lang/std/artifactGraph-README.md`
- `src/network/connectionManager.ts`
- `src/network/connection.ts`
- `src/components/ConnectionStream.tsx`
- `src/clientSideScene/sceneInfra.ts`
- `src/clientSideScene/sceneEntities.ts`
- `src/machines/systemIO/systemIOMachine.ts`
- `src/lib/fs-zds/index.ts`
- `src/lib/routeLoaders.ts`
- `src/components/LspProvider.tsx`
- `src/editor/plugins/lsp/worker.ts`
- `src/machines/mlEphantManagerMachine.ts`
- `src/machines/settingsMachine.ts`
- `src/lib/settings/initialSettings.tsx`
- `vitest.config.ts`
- `playwright.config.ts`
- `playwright.electron.config.ts`
- `rust/Cargo.toml`
- `rust/kcl-lib/src/lib.rs`
- `rust/kcl-wasm-lib/src/wasm.rs`
- `rust/kcl-wasm-lib/src/api.rs`
- `rust/kcl-wasm-lib/src/lsp.rs`

