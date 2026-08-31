/**
 * The `Configuration` KCL executes against.
 *
 * `Context.execute` takes the same JSON shape as `user.toml`: `kcl-lib` turns
 * `settings.modeling` into its `ExecutorSettings`. So the three preferences it
 * actually reads are threaded through here rather than left at their defaults,
 * which is what makes "highlight edges" mean the same thing to the engine and to
 * the executor.
 *
 * Built from the WASM defaults rather than from `{}`, so fields this app has no
 * setting for keep whatever `kcl-lib` considers correct.
 */
export interface KclModelingSettings {
  highlightEdges: boolean
  enableSsao: boolean
  showScaleGrid: boolean
  /**
   * The unit an unsuffixed number means, in a file that declares none.
   *
   * The one setting here that changes the *geometry* rather than how it is drawn:
   * a file with no `@settings` annotation is measured in whatever this says, so
   * getting it wrong makes every dimension wrong by a constant factor and nothing
   * on screen says why. Which is also why a new file in a project that is not in
   * millimetres has the unit written into it — see `lib/kcl/metaSettings.ts`.
   */
  baseUnit: string
}

type Table = Record<string, unknown>

const table = (value: unknown): Table =>
  typeof value === 'object' && value !== null ? { ...(value as Table) } : {}

export function executorSettingsJson(
  defaults: unknown,
  values: KclModelingSettings
): string {
  const configuration = table(defaults)
  const settings = table(configuration.settings)
  const modeling = table(settings.modeling)

  modeling.base_unit = values.baseUnit
  modeling.highlight_edges = values.highlightEdges
  modeling.enable_ssao = values.enableSsao
  modeling.show_scale_grid = values.showScaleGrid

  settings.modeling = modeling
  configuration.settings = settings
  return JSON.stringify(configuration)
}
