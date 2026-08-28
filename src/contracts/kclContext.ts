import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'

/**
 * The WASM `Context`, as this app calls it.
 *
 * One object in kcl-lib carries two very different APIs: `execute`, which runs a
 * program against the engine, and the sketch frontend, which runs a sketch block
 * without ever contacting one. They are the same object because they share the
 * program, the settings and the cached execution state — which is exactly why
 * this app must hold **one** of them. Two contexts would mean two ideas of what
 * the file says and two scenes on the engine.
 *
 * Declared here rather than in the executor because two features now call it:
 * the executor owns its lifetime, sketching borrows it.
 */
export interface KclWasmContext {
  execute(
    programAstJson: string,
    path: string | null | undefined,
    settings: string
  ): Promise<unknown>
  sendResponse(data: Uint8Array): Promise<void>
  bustCacheAndResetScene(
    settings: string,
    path?: string | null
  ): Promise<unknown>

  /*
   * The sketch frontend. Every one of these answers with the whole new file text
   * and the whole new scene graph, and none of them talks to the engine — that
   * is what makes editing a sketch cheap and exiting one expensive.
   *
   * Arguments are JSON strings because wasm-bindgen takes `&str`; the shapes are
   * generated in `@rust/kcl-lib/bindings/FrontendApi`.
   */
  open_project(project: number, files: string, openFile: number): Promise<void>
  update_file(project: number, file: number, text: string): Promise<void>
  edit_sketch(
    projectJson: string,
    fileJson: string,
    versionJson: string,
    sketchJson: string,
    settings: string
  ): Promise<unknown>
  exit_sketch(
    versionJson: string,
    sketchJson: string,
    settings: string
  ): Promise<unknown>
  add_segment(
    versionJson: string,
    sketchJson: string,
    segmentJson: string,
    label: string | undefined,
    settings: string,
    createCheckpoint: boolean
  ): Promise<unknown>
  sketch_execute_mock(
    versionJson: string,
    sketchJson: string,
    settings: string
  ): Promise<unknown>
}

export interface KclContextHandle {
  context: KclWasmContext
  wasm: unknown
  /**
   * kcl-lib's own defaults, parsed.
   *
   * The base for each call's settings rather than something serialised once: a
   * preference can change between two calls, and fields this app has no setting
   * for should keep whatever the library considers correct.
   */
  defaultSettings: unknown
}

/**
 * Borrowing the execution context.
 *
 * The executor owns it — its lifetime is the engine connection's, because it
 * holds a scene on the engine — and hands it out here. Optional for consumers:
 * a build with no executor simply cannot sketch, which is the same answer as a
 * build with no engine.
 */
export interface KclContextService {
  /** True once a context exists, without creating one. */
  readonly available: ReadonlySignal<boolean>
  /** The context, creating and loading it if this is the first ask. */
  get(): Promise<KclContextHandle>
}

export const kclContextContract = defineContract({
  kclContextService: defineService<KclContextService>('kcl.context'),
})

export const { kclContextService } = kclContextContract
