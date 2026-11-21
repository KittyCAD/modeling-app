import type {
  CurrentProjectPublicationDetails,
  ProjectPublishSubmission,
  PublishedProject,
} from '@src/lib/publishing/publication'
import { isErr } from '@src/lib/trap'

/** A prepared publication owns its target even if the user navigates elsewhere. */
export interface PublicationTarget {
  publish: () => Promise<PublishedProject | false>
  loadDetails: (
    remoteProjectId: string
  ) => Promise<CurrentProjectPublicationDetails | null | Error>
}

/** Successful submission and refreshing its metadata are independent outcomes. */
export interface PublicationResult {
  published: PublishedProject
  details: CurrentProjectPublicationDetails | null | Error
}

export interface PublicationWorkflow {
  loadDetails: () => Promise<CurrentProjectPublicationDetails | null | Error>
  submit: (
    submission: ProjectPublishSubmission
  ) => Promise<PublicationResult | false | Error>
}

function publicationError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error('Publishing the project failed.')
}

/** Storage adapters prepare a target; shared orchestration publishes and refreshes that target. */
export function createPublicationWorkflow({
  loadDetails,
  prepare,
}: {
  loadDetails: PublicationWorkflow['loadDetails']
  prepare: (
    submission: ProjectPublishSubmission
  ) => Promise<PublicationTarget | false | Error>
}): PublicationWorkflow {
  return {
    loadDetails,
    submit: async (submission) => {
      try {
        const target = await prepare(submission)
        if (!target || isErr(target)) return target
        const published = await target.publish()
        if (!published) return false
        const details = await target
          .loadDetails(published.remoteProjectId)
          .catch(publicationError)
        return { published, details }
      } catch (error) {
        return publicationError(error)
      }
    },
  }
}
