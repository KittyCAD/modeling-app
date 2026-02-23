import { computed, effect, signal } from '@preact/signals-core'
import { StatusBarItemType } from '@src/components/StatusBar/statusBarTypes'
import { Command, CommandConfig } from '@src/lib/commandTypes'
import {
  AreaType,
  AreaTypeDefinition,
  LayoutTransformationSet,
} from '@src/lib/layout'
import { Extension, ExtensionConfigurable, ZDSFacet } from './facet'
import { Field } from './field'
import { isDesktop } from './isDesktop'
import {
  APP_DOWNLOAD_PATH,
  APP_VERSION,
  getReleaseUrl,
} from '@src/routes/utils'
import { withSiteBaseURL } from './withBaseURL'
import { FeatureTreePane } from '@src/components/layout/areas/FeatureTreePane'

export type ExtensionConfig = Partial<{
  commands: Command[]
  layouts: LayoutTransformationSet[]
  statusBarItems: StatusBarConfig
}>

export type StatusBarConfig = {
  global: StatusBarItemType[]
  local: StatusBarItemType[]
}

const statusBarFacet = ZDSFacet.define<StatusBarConfig, StatusBarConfig>({
  combine: (inputs) => ({
    global: inputs.flatMap((ext) => ext.value.global),
    local: inputs.flatMap((ext) => ext.value.local),
  }),
})
export const statusBarField = Field.fromFacet('statusBar', statusBarFacet)

export const statusBar: Extension = [statusBarFacet, statusBarField]

// Now use the status bar extension in a narrower extension that registers
// a status bar item, also providing reactivity hooks through signals.
export const versionClicky = signal(0)
const appVersionCompartment = signal<Extension>([
  statusBarFacet.extendDynamic(
    computed(() => ({
      global: [
        {
          id: 'download-desktop-app',
          element: 'externalLink',
          label: `Download the app ${versionClicky.value}`,
          href: withSiteBaseURL(`/${APP_DOWNLOAD_PATH}`),
          icon: 'download',
          toolTip: {
            children:
              "The present web app is limited in features. We don't want you to miss out!",
          },
        },
      ],
      local: [],
    }))
  ),
])
export const appVersion = new ExtensionConfigurable({
  title: 'Status Bar: App Version',
  description: 'Shows the current app version in the status bar',
})

const areaLibrary = ZDSFacet.define<
  [string, AreaTypeDefinition],
  Map<string, AreaTypeDefinition>
>({
  combine: (inputs) => {
    const output = new Map()
    for (const input of inputs) {
      const [key, value] = input.value
      output.set(key, value)
    }
    return output
  },
})

// If you want to make the facet available in app state, do this
const areaLibraryField = Field.fromFacet('areaLibrary', areaLibrary)

const featureTreeArea = areaLibrary.extendStatic([
  'featureTree',
  {
    hide: () => false,
    shortcut: 'Shift + T',
    Component: FeatureTreePane,
  },
])
