import { useSignals } from '@preact/signals-react/runtime'
import { useEffect } from 'react'
import toast from 'react-hot-toast'
import { showWarningToast } from '@src/components/ToastWarning'
import type { CloudStorageService } from '@src/lib/cloudProjects/registry/contract'

export function ProjectArchiveLimitToast({
  cloud,
}: {
  cloud: Pick<
    CloudStorageService,
    'archiveLimitFailure' | 'dismissArchiveLimitFailure'
  >
}) {
  useSignals()
  const failure = cloud.archiveLimitFailure.value
  useEffect(() => {
    if (!failure) return
    const id = showWarningToast(
      <span role="alert">
        {failure.message}{' '}
        <a
          href="https://community.zoo.dev/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Contact support
        </a>
      </span>,
      {
        id: 'project-archive-limit',
        title: `Project exceeds ${failure.limitLabel}`,
        duration: Infinity,
        onDismiss: cloud.dismissArchiveLimitFailure,
      }
    )
    return () => toast.remove(id)
  }, [cloud, failure])
  return null
}
