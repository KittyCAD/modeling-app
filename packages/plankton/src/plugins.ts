import {
  contribute,
  factory,
  Facet,
  type Extension,
  provide,
  type Service,
  type Signal,
  type Factory,
  service,
  slot,
} from './algebra'

/** A plugin stays installed while its independently owned content is toggled. */
export interface PluginController {
  readonly active: Signal<boolean>
  enable(): Promise<void>
  disable(): Promise<void>
  toggle(): Promise<void>
}

interface PluginInfo {
  readonly id: string
  readonly title: string
  readonly description: string
}

export interface PluginRecord extends PluginInfo {
  readonly service: Service<PluginController>
}

export const plugins = new Facet(
  'plugins',
  (records: readonly PluginRecord[]) => records
)

export function createPlugin({
  items,
  enabledByDefault = true,
  ...info
}: PluginInfo & {
  readonly items: readonly Extension[]
  readonly enabledByDefault?: boolean
}): Factory {
  const enabled = new Facet(
    'plugin.active',
    (values: readonly boolean[]) => values.length > 0
  )
  const content = Object.freeze([contribute(enabled, () => true), ...items])
  const body = slot(enabledByDefault ? content : [])
  const controller = service<PluginController>(`${info.id}.controller`)
  return factory({
    key: info.id,
    create: (_dependencies, scope) => ({
      items: [
        body,
        contribute(plugins, () => ({ ...info, service: controller })),
        provide(controller, {
          active: scope.observe(enabled),
          enable: () => scope.replace(body, content),
          disable: () => scope.replace(body, []),
          toggle: () =>
            scope.replace(body, scope.observe(enabled).value ? [] : content),
        }),
      ],
    }),
  })
}
