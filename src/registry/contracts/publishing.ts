import { contract, Facet } from 'plankton'

/** Active publishing contributions own publication UI and its status requests. */
export const publishingContract = contract({
  projectPublicationEnabledFacet: new Facet<boolean, boolean>(
    'project-publication-enabled',
    (inputs) => inputs[0] ?? false
  ),
})

export const { projectPublicationEnabledFacet } = publishingContract
