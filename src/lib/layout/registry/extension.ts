import { computed, effect, signal } from '@preact/signals-core'
import { playwrightLayoutConfig } from '@src/lib/layout/configs/playwright'
import {
  observations as layoutObservations,
  layoutService,
} from '@src/lib/layout/registry/contract'
import type { Layout, LayoutService } from '@src/lib/layout/types'
import {
  applyLayoutContribution,
  applyPaneOpenBehavior,
  createLayoutWithMetadata,
  defaultLayout,
  loadLayout,
  saveLayout,
  setLayoutSaveHandler,
  togglePaneLayoutNode,
} from '@src/lib/layout/utils'
import { getOnlySettingsFromContext } from '@src/machines/settingsMachine'
import { userFeaturesContextHas } from '@src/machines/userFeaturesMachine'
import type { RuntimeRegistryService } from '@src/registry/contracts/runtime'
import { runtimeExtension } from '@src/registry/extensions/runtime'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import { settingsExtension } from '@src/registry/extensions/settings'
import type { UserFeaturesRegistryService } from '@src/registry/contracts/userFeatures'
import { userFeaturesExtension } from '@src/registry/extensions/userFeatures'
import { factory as defineFactory, provide, type Factory } from 'plankton'
import type { SnapshotFrom } from 'xstate'

const DEFAULT_LAYOUT_CONFIG_NAME = 'default'
const PLAYWRIGHT_LAYOUT_CONFIG_NAME = 'test'
export const createLayoutExtension = (
  runtime: Factory<RuntimeRegistryService> = runtimeExtension,
  {
    settings = settingsExtension,
    userFeatures = userFeaturesExtension,
  }: {
    settings?: Factory<SettingsRegistryService>
    userFeatures?: Factory<UserFeaturesRegistryService>
  } = {}
) =>
  defineFactory({
    dependencies: {
      runtime,
      settings,
      userFeatures,
      layout: layoutObservations,
    },
    key: 'layout-extension',
    create: ({ runtime, settings, userFeatures, layout: layoutInputs }) => {
      let layout: LayoutService | undefined
      let disposeLayout: (() => void) | undefined

      const ensureLayout = () => {
        if (layout) {
          return layout
        }
        const settingsActor = settings.actor
        const usePlaywrightLayout = runtime.get().isPlaywright
        const layoutConfigName = usePlaywrightLayout
          ? PLAYWRIGHT_LAYOUT_CONFIG_NAME
          : DEFAULT_LAYOUT_CONFIG_NAME
        const runtimeDefaultLayout = usePlaywrightLayout
          ? playwrightLayoutConfig
          : defaultLayout
        const layoutSignal = signal<Layout>(runtimeDefaultLayout)
        let hasHydratedLayout = false
        let lastUserFeatureValues = new Map<string, boolean>()

        const applyContributions: LayoutService['applyContributions'] = (
          contributions
        ) => {
          const rootLayout = structuredClone(layoutSignal.peek())
          const paneOpenBehavior =
            settings.get().layout.paneOpenBehavior.current
          const results = contributions.map((contribution) =>
            applyLayoutContribution({
              rootLayout,
              contribution,
              config: { paneOpenBehavior },
            })
          )

          if (results.some((result) => result.applied)) {
            layoutSignal.value = rootLayout
          }

          return results
        }
        const get = () => layoutSignal.value
        const set = (nextLayout: Layout) => {
          layoutSignal.value = structuredClone(nextLayout)
          return layoutSignal.value
        }

        function openPane(paneId: string) {
          return set(
            togglePaneLayoutNode({
              rootLayout: structuredClone(get()),
              targetNodeId: paneId,
              shouldExpand: true,
              paneOpenBehavior: settings.get().layout.paneOpenBehavior.current,
            })
          )
        }

        function togglePane(paneId: string) {
          const rootLayout = structuredClone(get())
          const paneOpenBehavior =
            settings.get().layout.paneOpenBehavior.current
          return set(
            togglePaneLayoutNode({
              rootLayout,
              targetNodeId: paneId,
              paneOpenBehavior,
            })
          )
        }

        const coreLayoutService: LayoutService = {
          signal: layoutSignal,
          get,
          set,
          reset: () => {
            layoutSignal.value = structuredClone(runtimeDefaultLayout)
            lastUserFeatureValues.clear()
            syncUserFeatureLayout()
          },
          applyContributions,
          openPane,
          togglePane,
        }
        const applyRegistryLayoutContributions = () =>
          coreLayoutService.applyContributions(
            layoutInputs.layoutContributionsFacet.value
          )
        const syncUserFeatureLayout = () => {
          const transformations =
            layoutInputs.layoutUserFeatureTransformationsFacet.value
          const userFeaturesContext = userFeatures.context.value
          if (!hasHydratedLayout) {
            return
          }

          const featureValues = new Map(
            transformations.map((transformation) => [
              transformation.id,
              userFeaturesContextHas(
                userFeaturesContext,
                transformation.feature,
                transformation.defaultValue ?? false
              ),
            ])
          )
          const changedTransformations = transformations.filter(
            (transformation) =>
              lastUserFeatureValues.get(transformation.id) !==
              featureValues.get(transformation.id)
          )
          if (changedTransformations.length === 0) {
            lastUserFeatureValues = featureValues
            return
          }

          let nextLayout = structuredClone(layoutSignal.peek())
          for (const transformation of changedTransformations) {
            nextLayout = transformation.transform(
              nextLayout,
              featureValues.get(transformation.id) ?? false
            )
          }
          layoutSignal.value = nextLayout
          lastUserFeatureValues = featureValues
        }
        const hydrateLayoutFromSettings = (
          snapshot: SnapshotFrom<typeof settingsActor>
        ) => {
          if (hasHydratedLayout || snapshot.value !== 'idle') {
            return
          }

          setLayoutSaveHandler(({ layout, layoutName }) => {
            const currentLayouts = getOnlySettingsFromContext(
              settingsActor.getSnapshot().context
            ).layout.configs.current

            settingsActor.send({
              type: 'set.layout.configs',
              data: {
                level: 'user',
                value: {
                  ...currentLayouts,
                  [layoutName ?? DEFAULT_LAYOUT_CONFIG_NAME]:
                    createLayoutWithMetadata(layout),
                },
              },
            })
          })

          const settingsSnapshot = getOnlySettingsFromContext(snapshot.context)
          const settingsLayout =
            settingsSnapshot.layout.configs.current[layoutConfigName] ??
            settingsSnapshot.layout.configs.current.default
          if (settingsLayout) {
            layoutSignal.value = structuredClone(settingsLayout.layout)
          } else {
            const legacyLayout = loadLayout(layoutConfigName)
            const fallbackLegacyLayout =
              legacyLayout instanceof Error &&
              layoutConfigName !== DEFAULT_LAYOUT_CONFIG_NAME
                ? loadLayout(DEFAULT_LAYOUT_CONFIG_NAME)
                : legacyLayout
            if (!(fallbackLegacyLayout instanceof Error)) {
              layoutSignal.value = structuredClone(fallbackLegacyLayout)
            }
          }

          hasHydratedLayout = true
          applyRegistryLayoutContributions()
          syncUserFeatureLayout()
        }

        const settingsSubscription = settingsActor.subscribe(
          hydrateLayoutFromSettings
        )
        hydrateLayoutFromSettings(settingsActor.getSnapshot())
        const stopUserFeatureLayoutEffect = effect(() => {
          syncUserFeatureLayout()
        })
        const stopLayoutContributionsEffect = effect(() => {
          const contributions = layoutInputs.layoutContributionsFacet.value
          if (hasHydratedLayout) {
            coreLayoutService.applyContributions(contributions)
          }
        })
        // Settings reactions belong to the layout service, which also owns their lifetime.
        const stopPanePreferenceEffect = effect(() => {
          const behavior =
            settings.current.value.layout.paneOpenBehavior.currentSignal.value
          layoutSignal.value = applyPaneOpenBehavior(
            layoutSignal.peek(),
            behavior
          )
        })
        const saveEffectUnsubscribeFn = effect(() =>
          saveLayout({
            layout: layoutSignal.value,
            layoutName: layoutConfigName,
          })
        )

        layout = coreLayoutService
        disposeLayout = () => {
          settingsSubscription.unsubscribe()
          stopPanePreferenceEffect()
          stopUserFeatureLayoutEffect()
          stopLayoutContributionsEffect()
          saveEffectUnsubscribeFn()
          setLayoutSaveHandler(undefined)
        }
        return layout
      }

      const serviceImpl: LayoutService = {
        signal: computed(() => ensureLayout().signal.value),
        get: () => ensureLayout().get(),
        set: (layout) => ensureLayout().set(layout),
        reset: () => ensureLayout().reset(),
        applyContributions: (contributions) =>
          ensureLayout().applyContributions(contributions),
        togglePane: (layoutId) => ensureLayout().togglePane(layoutId),
        openPane: (layoutId) => ensureLayout().openPane(layoutId),
      }

      return {
        exports: serviceImpl,
        items: [provide(layoutService, serviceImpl)],
        dispose: () => {
          disposeLayout?.()
        },
      }
    },
  }) satisfies Factory
export const layoutExtension = createLayoutExtension()
export default [layoutExtension]
