import { Slot, defineContract, defineValueSpec } from '@kittycad/registry'
import type { modelingMachine } from '@src/machines/modelingMachine'
import type { ComponentType, Dispatch, SetStateAction } from 'react'
import { twMerge } from 'tailwind-merge'
import type { EventFrom, StateFrom } from 'xstate'

export const engineSceneViewExtensionZones = [
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
  'overlay',
] as const

export type EngineSceneViewExtensionZone =
  (typeof engineSceneViewExtensionZones)[number]

export const engineSceneRuntimeExtensionsSlot = new Slot()

export type EngineSceneExtensionContext = {
  modelingState: StateFrom<typeof modelingMachine>
  modelingSend: (event: EventFrom<typeof modelingMachine>) => void
  sketchSolveStreamDimming: number
  setSketchSolveStreamDimming: Dispatch<SetStateAction<number>>
}

export type EngineSceneViewExtensionProps = EngineSceneExtensionContext
export type EngineSceneStreamLayerProps = EngineSceneExtensionContext

export type EngineSceneViewExtension = {
  id: string
  zone: EngineSceneViewExtensionZone
  order?: number
  Component: ComponentType<EngineSceneViewExtensionProps>
  wrapperClassName?: string
  shouldRegister?: (context: EngineSceneExtensionContext) => boolean
}

export type EngineSceneStreamClassName = {
  id: string
  order?: number
  className: string
}

export type EngineSceneStreamLayer = {
  id: string
  order?: number
  Component: ComponentType<EngineSceneStreamLayerProps>
  wrapperClassName?: string
}

const zoneOrder = Object.fromEntries(
  engineSceneViewExtensionZones.map((zone, index) => [zone, index])
) as Record<EngineSceneViewExtensionZone, number>

const sortByZoneAndOrder = (
  inputs: readonly EngineSceneViewExtension[]
): readonly EngineSceneViewExtension[] =>
  inputs.toSorted(
    (a, b) =>
      zoneOrder[a.zone] - zoneOrder[b.zone] || (a.order ?? 0) - (b.order ?? 0)
  )

const sortByOrder = <T extends { order?: number }>(
  inputs: readonly T[]
): readonly T[] => inputs.toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0))

export const defineEngineSceneViewExtension = <
  T extends EngineSceneViewExtension,
>(
  extension: T
): T => extension

export const defineEngineSceneStreamClassName = <
  T extends EngineSceneStreamClassName,
>(
  className: T
): T => className

export const defineEngineSceneStreamLayer = <T extends EngineSceneStreamLayer>(
  layer: T
): T => layer

export const engineSceneContract = defineContract({
  engineSceneViewExtensionsValueSpec: defineValueSpec<
    EngineSceneViewExtension,
    readonly EngineSceneViewExtension[]
  >({
    name: 'engine-scene.view-extensions',
    defaultValue: [],
    combine: sortByZoneAndOrder,
  }),
  engineSceneStreamClassNamesValueSpec: defineValueSpec<
    EngineSceneStreamClassName,
    readonly EngineSceneStreamClassName[]
  >({
    name: 'engine-scene.stream-class-names',
    defaultValue: [],
    combine: sortByOrder,
  }),
  engineSceneStreamLayersValueSpec: defineValueSpec<
    EngineSceneStreamLayer,
    readonly EngineSceneStreamLayer[]
  >({
    name: 'engine-scene.stream-layers',
    defaultValue: [],
    combine: sortByOrder,
  }),
})

export const {
  engineSceneViewExtensionsValueSpec,
  engineSceneStreamClassNamesValueSpec,
  engineSceneStreamLayersValueSpec,
} = engineSceneContract

export function resolveEngineSceneViewExtensions(
  extensions: readonly EngineSceneViewExtension[],
  context: EngineSceneExtensionContext
) {
  return extensions.filter(
    (extension) => extension.shouldRegister?.(context) ?? true
  )
}

const zoneClassNames: Record<EngineSceneViewExtensionZone, string> = {
  'top-left': 'absolute top-2 left-2 flex items-start justify-start gap-2',
  top: 'absolute top-0 left-2 right-2 flex items-start justify-center gap-2',
  'top-right': 'absolute top-2 right-2 flex items-start justify-end gap-2',
  left: 'absolute left-2 top-1/2 -translate-y-1/2 flex flex-col items-start justify-center gap-2',
  center: 'absolute inset-2 flex flex-col items-center justify-center gap-2',
  right:
    'absolute right-2 top-1/2 -translate-y-1/2 flex flex-col items-end justify-center gap-2',
  'bottom-left': 'absolute bottom-2 left-2 flex items-end justify-start gap-2',
  bottom:
    'absolute bottom-2 left-2 right-2 flex items-end justify-center gap-2',
  'bottom-right': 'absolute bottom-2 right-2 flex items-end justify-end gap-3',
  overlay: 'absolute inset-0',
}

type EngineSceneViewExtensionOverlayProps = EngineSceneExtensionContext & {
  extensions: readonly EngineSceneViewExtension[]
}

export function EngineSceneViewExtensionOverlay({
  extensions,
  ...context
}: EngineSceneViewExtensionOverlayProps) {
  const registeredExtensions = resolveEngineSceneViewExtensions(
    extensions,
    context
  )

  return (
    <div
      className="absolute inset-0 z-10 pointer-events-none"
      aria-hidden={registeredExtensions.length === 0}
    >
      {engineSceneViewExtensionZones.map((zone) => {
        const zoneExtensions = registeredExtensions.filter(
          (extension) => extension.zone === zone
        )

        if (zoneExtensions.length === 0) {
          return null
        }

        return (
          <div
            key={zone}
            className={zoneClassNames[zone]}
            data-engine-scene-view-extension-zone={zone}
          >
            {zoneExtensions.map((extension) => {
              const Component = extension.Component
              const wrapperClassName = `max-w-full pointer-events-auto ${extension.wrapperClassName ?? ''}`

              return (
                <div
                  key={extension.id}
                  className={wrapperClassName}
                  data-engine-scene-view-extension-id={extension.id}
                >
                  <Component {...context} />
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

export function mergeEngineSceneClassNames(
  contributions: readonly EngineSceneStreamClassName[]
): string {
  return twMerge(...contributions.map((contribution) => contribution.className))
}
