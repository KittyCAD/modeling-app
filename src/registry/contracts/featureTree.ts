import type React from 'react'
import { defineContract, defineValueSpec } from '@kittycad/registry'

export type FeatureTreeSection = {
  id: string
  order?: number
  Component: React.FC
}

type FeatureTreeSectionContribution =
  | FeatureTreeSection
  | false
  | null
  | undefined

export const featureTreeContract = defineContract({
  featureTreeSectionsValueSpec: defineValueSpec<
    FeatureTreeSectionContribution,
    readonly FeatureTreeSection[]
  >({
    name: 'featureTree.sections',
    defaultValue: [],
    combine: (inputs) => {
      const seen = new Set<string>()
      return inputs
        .filter((section): section is FeatureTreeSection => Boolean(section))
        .filter((section) => {
          if (seen.has(section.id)) {
            return false
          }
          seen.add(section.id)
          return true
        })
        .toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0))
    },
  }),
})

export const { featureTreeSectionsValueSpec } = featureTreeContract
