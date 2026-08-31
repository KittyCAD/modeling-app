/**
 * The wasm-bindgen surface of bevy-zoo's embed build.
 *
 * Hand-written rather than generated: the module is built out of tree by
 * `scripts/build-bevy.sh` and lands in `public/`, so there is no import for
 * TypeScript to follow.
 */
export interface BevyModule {
  /**
   * wasm-bindgen's initialiser. Must resolve before anything else is called.
   *
   * Always given the `.wasm` URL explicitly. Left to itself it resolves
   * `new URL('bevy_zoo_bg.wasm', import.meta.url)`, which would look for the
   * binary next to the glue — and the two deliberately do not live together.
   */
  default: (moduleOrPath?: unknown) => Promise<unknown>
  /** Take over the canvas matching a CSS selector and start rendering. */
  start: (canvas: string, token?: string | null, host?: string | null) => void
  /** `files` is a JSON object of name to contents; `entrypoint` names one of them. */
  push_project: (entrypoint: string, files: string) => void
  set_state_callback: (callback: (payload: string) => void) => void

  /*
   * The camera.
   *
   * Deltas are surface pixels with the surface size alongside; directions and
   * points are in Zoo's frame — Z-up, millimetres — so nothing here has to know
   * that glTF turned the model Y-up on the way in.
   */
  camera_orbit: (
    dx: number,
    dy: number,
    width: number,
    height: number,
    trackball: boolean
  ) => void
  camera_pan: (dx: number, dy: number, width: number, height: number) => void
  camera_zoom: (magnitude: number) => void
  camera_look_from: (
    x: number,
    y: number,
    z: number,
    upX: number,
    upY: number,
    upZ: number,
    upSet: boolean
  ) => void
  camera_face_on: (
    originX: number,
    originY: number,
    originZ: number,
    normalX: number,
    normalY: number,
    normalZ: number,
    yAxisX: number,
    yAxisY: number,
    yAxisZ: number
  ) => void
  camera_zoom_to_fit: () => void
  camera_set_projection: (projection: string) => void
}

/** What bevy-zoo reports about the solve it is running. */
export interface BevyJobState {
  status: 'idle' | 'connecting' | 'executing' | 'exporting' | 'ready' | 'failed'
  revision: number | null
  stage: string | null
  message: string | null
  timings: {
    solveMs: number | null
    exportResponseMs: number | null
    downloadMs: number | null
    sceneLoadMs: number | null
  }
}

/**
 * The glue is a module, so it must NOT be under `public/`.
 *
 * Vite rejects any import of a public path outright — "this file is in /public
 * and will be copied as-is during build without going through the plugin
 * transforms, and therefore should not be imported from source code. It can only
 * be referenced via HTML tags." Under `vendor/` it is an ordinary root-relative
 * module and Vite transforms it like any other.
 *
 * This mirrors kcl-wasm-lib, whose glue is imported from
 * `rust/kcl-wasm-lib/pkg` while only `kcl_wasm_lib_bg.wasm` sits in `public/`.
 *
 * Both paths are written by `scripts/build-bevy.sh` and are gitignored, so the
 * specifier stays a variable and carries `@vite-ignore`: nothing may try to
 * resolve it at build time, because `npm run build` does not build the renderer.
 */
const MODULE_URL = '/vendor/bevy/bevy_zoo.js'

/** Fetched by URL rather than imported, which is what `public/` is for. */
const WASM_URL = '/bevy/bevy_zoo_bg.wasm'

/**
 * Started once per page load, and never stopped.
 *
 * There is no way to ask a running Bevy app to exit from JavaScript, so a second
 * `start` would leave the first one rendering into a canvas nobody can see. This
 * is the mechanical reason the renderer setting applies on the next launch rather
 * than immediately.
 */
let starting: Promise<BevyModule> | null = null

/**
 * Resolves when the module is running, whenever that turns out to be.
 *
 * The camera driver is built when the feature is registered, but the module
 * cannot start until a canvas exists and the surface has mounted. This lets the
 * driver hold a promise from the beginning instead of the surface having to reach
 * back into the feature.
 */
let announceStarted: (module: BevyModule) => void = () => {}
const started = new Promise<BevyModule>((resolve) => {
  announceStarted = resolve
})

export function whenBevyStarted(): Promise<BevyModule> {
  return started
}

export interface StartOptions {
  /** CSS selector for a canvas already in the document. */
  canvas: string
  token: string | null
  host: string | null
  onState?: (state: BevyJobState) => void
}

export function startBevy(options: StartOptions): Promise<BevyModule> {
  starting ??= start(options)
  return starting
}

async function start(options: StartOptions): Promise<BevyModule> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    // Rejected rather than thrown: the caller already renders whatever comes
    // back here as the surface's error state.
    return Promise.reject(
      new Error(
        'This renderer needs WebGPU, which this browser does not report. Check chrome://gpu.'
      )
    )
  }

  /**
   * Imported by absolute URL and hidden from the bundler.
   *
   * The glue is a build artifact in `public/`, not a source module: Rollup would
   * try to resolve and bundle it, and fail.
   */
  const module = (await import(/* @vite-ignore */ MODULE_URL)) as BevyModule
  await module.default(WASM_URL)

  if (options.onState) {
    const onState = options.onState
    module.set_state_callback((payload) => {
      try {
        onState(JSON.parse(payload) as BevyJobState)
      } catch {
        // A state report we cannot read is not worth taking the renderer down
        // for; the geometry is unaffected.
      }
    })
  }

  module.start(options.canvas, options.token, options.host)
  announceStarted(module)
  return module
}

/** The module, if it has finished starting. Null before that. */
export function startedBevy(): Promise<BevyModule> | null {
  return starting
}
