import {
  defineContract,
  defineService,
  defineValueSpec,
} from '@kittycad/registry'
import type { ZooFeatureTree } from '@kittycad/ui-components/web-components'
import type { ReadonlySignal } from '@preact/signals-core'
import type { ComponentType } from 'react'

/** Sections contribute row fragments; one Browser tree owns hierarchy and navigation. */
export interface SceneBrowserSection {
  id: string
  title: string
  order?: number
  Component: ComponentType
  Menu?: ComponentType
}

export interface SceneBrowserService {
  tree: ReadonlySignal<ZooFeatureTree | null>
  setTree: (tree: ZooFeatureTree | null) => void
  collapsed: ReadonlySignal<boolean>
  toggle: () => void
}

export type SceneBrowserAppearance = 'hud' | 'default'

export const sceneBrowserContract = defineContract({
  sceneBrowserAppearance: defineValueSpec<
    SceneBrowserAppearance,
    SceneBrowserAppearance
  >({
    name: 'scene-browser.appearance',
    defaultValue: 'hud',
    combine: (appearances) => appearances.at(-1) ?? 'hud',
  }),
  sceneBrowserSections: defineValueSpec<
    SceneBrowserSection,
    readonly SceneBrowserSection[]
  >({
    name: 'scene-browser.sections',
    defaultValue: [],
    combine: (sections) =>
      sections.toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  }),
  sceneBrowserService: defineService<SceneBrowserService>(
    'scene-browser.service'
  ),
})
export const {
  sceneBrowserSections,
  sceneBrowserService,
  sceneBrowserAppearance,
} = sceneBrowserContract
export const TOGGLE_BROWSER_COMMAND = 'zds.sceneBrowser.toggle'

export const SCENE_BROWSER_FOCUSED_SCOPE = 'scene-browser.focused'
