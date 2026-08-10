import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  type ProjectLibrary,
} from '@src/lib/projectLibraries'

export const FREE_CLOUD_PROJECT_TRAINING_POLICY_URL =
  'https://zoo.dev/terms-and-conditions#7-customer-materials-and-data'

export function shouldShowFreeCloudProjectTrainingDisclosure({
  library,
  hasSubscription,
}: {
  library?: Pick<ProjectLibrary, 'type'>
  hasSubscription: boolean | undefined
}) {
  return (
    library?.type === CLOUD_PROJECT_LIBRARY_TYPE && hasSubscription === false
  )
}
