import { SettingsSection } from '@src/components/Settings/SettingsSection'
import { noAutofillInputProps } from '@src/lib/autofill'
import { MAX_PROJECT_NAME_LENGTH } from '@src/lib/constants'
import type { Project } from '@src/lib/project'
import { getProjectDisplayName } from '@src/lib/projectDisplayName'
import { reportRejection } from '@src/lib/trap'
import type {
  HomeProjectActionsService,
  HomeProjectEntry,
} from '@src/registry/contracts/homeProjects'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'

export const PROJECT_TITLE_SETTING_ID = 'projectTitle'
export const PROJECT_DETAILS_CATEGORY_ID = 'project-details'

interface ProjectTitleSettingsSectionProps {
  project: Project
  projectEntry?: HomeProjectEntry
  projectActions: HomeProjectActionsService
}

export function ProjectTitleSettingsSection({
  project,
  projectEntry,
  projectActions,
}: ProjectTitleSettingsSectionProps) {
  const projectTitle = getProjectDisplayName(project)
  const [draftTitle, setDraftTitle] = useState(projectTitle)
  const [isSaving, setIsSaving] = useState(false)
  const canEdit = Boolean(
    projectEntry && projectActions.canRename(projectEntry)
  )

  useEffect(() => {
    setDraftTitle(projectTitle)
  }, [projectTitle])

  async function updateProjectTitle(rawTitle: string) {
    const nextTitle = rawTitle.trim()
    if (!nextTitle) {
      toast.error('Project title cannot be empty.')
      setDraftTitle(projectTitle)
      return
    }
    if (
      nextTitle.length > MAX_PROJECT_NAME_LENGTH ||
      nextTitle === projectTitle ||
      !projectEntry ||
      !canEdit
    ) {
      setDraftTitle(projectTitle)
      return
    }

    setDraftTitle(nextTitle)
    setIsSaving(true)
    try {
      await projectActions.rename(projectEntry, nextTitle)
    } catch (error) {
      setDraftTitle(projectTitle)
      reportRejection(error)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <SettingsSection
      id={PROJECT_TITLE_SETTING_ID}
      title="Title"
      description="The name shown for this project throughout Design Studio."
    >
      <input
        {...noAutofillInputProps}
        aria-label="Project title"
        data-testid="project-title-setting"
        type="text"
        className="p-1 bg-transparent border rounded-sm border-chalkboard-30 w-full disabled:opacity-50 disabled:pointer-events-none"
        value={draftTitle}
        maxLength={MAX_PROJECT_NAME_LENGTH}
        disabled={!canEdit || isSaving}
        onChange={(event) => setDraftTitle(event.target.value)}
        onBlur={(event) => {
          void updateProjectTitle(event.currentTarget.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur()
          } else if (event.key === 'Escape') {
            setDraftTitle(projectTitle)
          }
        }}
      />
    </SettingsSection>
  )
}
