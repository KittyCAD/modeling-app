import { useSignals } from '@preact/signals-react/runtime'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import { billingService } from '@src/registry/contracts/billing'
import type { ProjectLibraryHomeDetailProps } from '@src/registry/contracts/projectLibraries'

const CLOUD_TRAINING_POLICY_URL =
  'https://zoo.dev/terms-and-conditions#7-customer-materials-and-data'

export function CloudLibraryTrainingDisclosure({
  library,
  registry,
}: ProjectLibraryHomeDetailProps) {
  useSignals()
  const hasSubscription =
    registry.optional(billingService)?.context.value.hasSubscription
  if (library.organizationId || hasSubscription !== false) return null

  return (
    <>
      Zoo trains on Free user cloud projects.{' '}
      <a
        href={CLOUD_TRAINING_POLICY_URL}
        onClick={openExternalBrowserIfDesktop(CLOUD_TRAINING_POLICY_URL)}
        className="text-chalkboard-90 dark:text-chalkboard-20 underline underline-offset-2"
      >
        See our policy
      </a>
    </>
  )
}
