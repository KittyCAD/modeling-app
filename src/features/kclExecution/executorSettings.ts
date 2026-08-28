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

  modeling.highlight_edges = values.highlightEdges
  modeling.enable_ssao = values.enableSsao
  modeling.show_scale_grid = values.showScaleGrid

  settings.modeling = modeling
  configuration.settings = settings
  return JSON.stringify(configuration)
}
