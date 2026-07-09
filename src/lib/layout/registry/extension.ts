import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { computed, effect, signal } from '@preact/signals-core'
import { BODIES_PANE_FEATURE_FLAG } from '@src/lib/constants'
import { playwrightLayoutConfig } from '@src/lib/layout/configs/playwright'
import type { Layout, LayoutService } from '@src/lib/layout/types'
import {
  applyLayoutContribution,
  createLayoutWithMetadata,
  defaultLayout,
  loadLayout,
  saveLayout,
  setBodiesPaneLayoutEnabled,
  setLayoutSaveHandler,
} from '@src/lib/layout/utils'
import {
  layoutContributionsValueSpec,
  layoutService,
} from '@src/lib/layout/registry/contract'
import { getOnlySettingsFromContext } from '@src/machines/settingsMachine'
import { userFeaturesContextHas } from '@src/machines/userFeaturesMachine'
import { runtimeService } from '@src/registry/contracts/runtime'
import { settingsService } from '@src/registry/contracts/settings'
import { userFeaturesService } from '@src/registry/contracts/userFeatures'
import type { SnapshotFrom } from 'xstate'

const DEFAULT_LAYOUT_CONFIG_NAME = 'default'
const PLAYWRIGHT_LAYOUT_CONFIG_NAME = 'test'

export const layoutExtension = defineRegistryItemFactory((ctx) => {
  let layout: LayoutService | undefined
  let disposeLayout: (() => void) | undefined

  const ensureLayout = () => {
    if (layout) {
      return layout
    }

    const runtime = ctx.services.get(runtimeService)
    const settings = ctx.services.get(settingsService)
    const userFeatures = ctx.services.get(userFeaturesService)
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
    let lastBodiesPaneFeatureEnabled: boolean | undefined

    const isBodiesPaneFeatureEnabled = () =>
      userFeaturesContextHas(
        userFeatures.context.value,
        BODIES_PANE_FEATURE_FLAG,
        false
      )
    const getRuntimeDefaultLayout = () =>
      setBodiesPaneLayoutEnabled(
        structuredClone(runtimeDefaultLayout),
        !usePlaywrightLayout && isBodiesPaneFeatureEnabled()
      )
    const applyContributions: LayoutService['applyContributions'] = (
      contributions
    ) => {
      const rootLayout = structuredClone(layoutSignal.peek())
      const results = contributions.map((contribution) =>
        applyLayoutContribution({ rootLayout, contribution })
      )

      if (results.some((result) => result.applied)) {
        layoutSignal.value = rootLayout
      }

      return results
    }
    const coreLayoutService: LayoutService = {
      signal: layoutSignal,
      get: () => layoutSignal.value,
      set: (nextLayout) => {
        layoutSignal.value = structuredClone(nextLayout)
      },
      reset: () => {
        layoutSignal.value = getRuntimeDefaultLayout()
      },
      applyContributions,
    }
    const applyRegistryLayoutContributions = () =>
      coreLayoutService.applyContributions(
        ctx.valueSpecs.get(layoutContributionsValueSpec)
      )
    const syncBodiesPaneFeatureLayout = () => {
      if (!hasHydratedLayout || usePlaywrightLayout) {
        return
      }

      const enabled = isBodiesPaneFeatureEnabled()
      if (enabled === lastBodiesPaneFeatureEnabled) {
        return
      }

      const currentLayout = layoutSignal.peek()
      const nextLayout = setBodiesPaneLayoutEnabled(currentLayout, enabled)
      if (nextLayout !== currentLayout) {
        layoutSignal.value = nextLayout
      }
      lastBodiesPaneFeatureEnabled = enabled
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
      syncBodiesPaneFeatureLayout()
    }

    const settingsSubscription = settingsActor.subscribe(
      hydrateLayoutFromSettings
    )
    hydrateLayoutFromSettings(settingsActor.getSnapshot())
    const stopUserFeaturesEffect = effect(() => {
      syncBodiesPaneFeatureLayout()
    })
    const stopLayoutContributionsEffect = effect(() => {
      const contributions = ctx.valueSpecs.signal(
        layoutContributionsValueSpec
      ).value
      if (hasHydratedLayout) {
        coreLayoutService.applyContributions(contributions)
      }
    })
    const saveEffectUnsubscribeFn = effect(() =>
      saveLayout({ layout: layoutSignal.value, layoutName: layoutConfigName })
    )

    layout = coreLayoutService
    disposeLayout = () => {
      settingsSubscription.unsubscribe()
      stopUserFeaturesEffect()
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
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'layout-extension',
      providesServices: [provideService(layoutService, serviceImpl)],
      dispose: () => {
        disposeLayout?.()
      },
    }),
  }
}, 'layout-extension')

export default defineRegistryItem({
  id: 'layout',
  uses: [layoutExtension],
})
