import { SettingsSection } from '@src/components/Settings/SettingsSection'
import { noAutofillInputProps } from '@src/lib/autofill'
import { MAX_PROJECT_NAME_LENGTH } from '@src/lib/constants'
import type { Project } from '@src/lib/project'
import { getProjectDisplayName } from '@src/lib/projectDisplayName'
import type { ProjectTitleService } from '@src/lib/projectTitle'
import { trap } from '@src/lib/trap'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'

export const PROJECT_TITLE_SETTING_ID = 'projectTitle'

interface ProjectTitleSettingsSectionProps {
  project: Project
  service: ProjectTitleService
}

export function ProjectTitleSettingsSection({
  project,
  service,
}: ProjectTitleSettingsSectionProps) {
  const projectTitle = getProjectDisplayName(project)
  const [draftTitle, setDraftTitle] = useState(projectTitle)
  const [isSaving, setIsSaving] = useState(false)
  const canEdit = service.canUpdateTitle(project)

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
      !canEdit
    ) {
      setDraftTitle(projectTitle)
      return
    }

    setDraftTitle(nextTitle)
    setIsSaving(true)
    try {
      await service.updateTitle(project, nextTitle)
    } catch (error: unknown) {
      setDraftTitle(projectTitle)
      trap(error instanceof Error ? error : new Error(String(error)), {
        altErr: new Error('Could not update project title. Please try again.'),
      })
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
