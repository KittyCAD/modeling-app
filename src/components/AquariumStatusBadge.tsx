import type { ProjectStatus } from '@src/hooks/useProjectStatus'

type AquariumStatusBadgePresentation = {
  label: string
  className: string
  testId: string
}

const aquariumStatusBadges = {
  private: undefined,
  draft: undefined,
  pending_review: {
    label: 'Pending Review',
    className:
      'bg-river-20 text-chalkboard-100 ring-river-60/40 dark:bg-river-80 dark:text-chalkboard-10 dark:ring-river-30/40',
    testId: 'pending-review-badge',
  },
  published: {
    label: 'Published',
    className:
      'bg-succeed-20 text-chalkboard-100 ring-succeed-60/40 dark:bg-succeed-80 dark:text-chalkboard-10 dark:ring-succeed-30/40',
    testId: 'published-badge',
  },
  rejected: {
    label: 'Rejected',
    className:
      'bg-destroy-20 text-chalkboard-100 ring-destroy-60/40 dark:bg-destroy-80 dark:text-chalkboard-10 dark:ring-destroy-30/40',
    testId: 'rejected-badge',
  },
  deleted: undefined,
  changes_requested: {
    label: 'Changes requested',
    className:
      'bg-warn-20 text-chalkboard-100 ring-warn-60/40 dark:bg-warn-80 dark:text-chalkboard-10 dark:ring-warn-30/40',
    testId: 'changes-requested-badge',
  },
} satisfies Record<
  ProjectStatus['publicationStatus'],
  AquariumStatusBadgePresentation | undefined
>

const changesRequestedRepublishMessage =
  'Republishing will put the project back into the review queue.'

export function getAquariumStatusBadge(
  projectStatus: ProjectStatus | null | undefined
) {
  return projectStatus
    ? aquariumStatusBadges[projectStatus.publicationStatus]
    : undefined
}

export function AquariumStatusBadge({
  projectStatus,
  className,
  dataTestId,
}: {
  projectStatus: ProjectStatus
  className?: string
  dataTestId?: string
}) {
  const badge = getAquariumStatusBadge(projectStatus)
  if (!badge) {
    return null
  }

  const badgeClassName = `${className ?? ''} ${badge.className}`

  return (
    <span className={badgeClassName} data-testid={dataTestId ?? badge.testId}>
      <span className="sr-only">Aquarium status: </span>
      {badge.label}
    </span>
  )
}

export function AquariumStatusDetails({
  projectStatus,
}: {
  projectStatus: ProjectStatus | null | undefined
}) {
  const badge = getAquariumStatusBadge(projectStatus)
  if (!badge || !projectStatus) {
    return null
  }

  const changesRequested =
    projectStatus.publicationStatus === 'changes_requested'

  return (
    <section
      className="rounded-lg border border-chalkboard-20/80 bg-chalkboard-20/40 p-3 dark:border-chalkboard-80/70 dark:bg-chalkboard-100/30"
      data-testid="publish-dialog-aquarium-status"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-chalkboard-60 dark:text-chalkboard-40">
          Aquarium status
        </p>
        <AquariumStatusBadge
          projectStatus={projectStatus}
          className="inline-flex shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium leading-none shadow-sm ring-1 ring-inset"
          dataTestId="publish-dialog-aquarium-status-badge"
        />
      </div>

      {changesRequested && (
        <div className="mt-3 border-t border-chalkboard-30/70 pt-3 text-xs leading-5 dark:border-chalkboard-70/70">
          <p className="font-medium text-chalkboard-100 dark:text-chalkboard-10">
            Reviewer feedback
          </p>
          <p className="mt-1 text-chalkboard-70 dark:text-chalkboard-30">
            {projectStatus.feedback || 'No reviewer feedback was provided.'}
          </p>
          <p className="mt-2 text-chalkboard-70 dark:text-chalkboard-30">
            {changesRequestedRepublishMessage}
          </p>
        </div>
      )}
    </section>
  )
}
