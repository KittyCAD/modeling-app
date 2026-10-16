import { defineContract, firstWinsValueSpec } from '@kittycad/registry'

/** Active publishing contributions own publication UI and its status requests. */
export const publishingContract = defineContract({
  projectPublicationEnabledValueSpec: firstWinsValueSpec(
    'project-publication-enabled',
    false
  ),
})

export const { projectPublicationEnabledValueSpec } = publishingContract
