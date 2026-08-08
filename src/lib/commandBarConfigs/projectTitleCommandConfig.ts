import type { Command } from '@src/lib/commandTypes'
import { MAX_PROJECT_NAME_LENGTH } from '@src/lib/constants'
import type { Project } from '@src/lib/project'
import { getProjectDisplayName } from '@src/lib/projectDisplayName'
import type { ProjectTitleService } from '@src/lib/projectTitle'
import toast from 'react-hot-toast'

export const PROJECT_TITLE_COMMAND_NAME = 'project.title'

function validateProjectTitle(value: unknown) {
  const title = String(value ?? '').trim()
  if (!title) {
    return 'Project title cannot be empty.'
  }
  if (title.length > MAX_PROJECT_NAME_LENGTH) {
    return `Project title must be ${MAX_PROJECT_NAME_LENGTH} characters or fewer.`
  }

  return true
}

export function createProjectTitleCommand({
  getCurrentProject,
  service,
}: {
  getCurrentProject: () => Project | undefined
  service?: ProjectTitleService
}): Command | null {
  if (!getCurrentProject() || !service) {
    return null
  }

  const canUpdateTitle = () => {
    const project = getCurrentProject()
    return Boolean(project && service.canUpdateTitle(project))
  }

  return {
    name: PROJECT_TITLE_COMMAND_NAME,
    displayName: 'Settings · project · title',
    description: 'The name shown for this project throughout Design Studio.',
    groupId: 'settings',
    icon: 'settings',
    needsReview: false,
    get disabled() {
      return !canUpdateTitle()
    },
    get hideFromSearch() {
      return !canUpdateTitle()
    },
    onSubmit: (data) => {
      const project = getCurrentProject()
      const validation = validateProjectTitle(data?.value)
      if (validation !== true) {
        toast.error(validation)
        return
      }
      if (!project || !service.canUpdateTitle(project)) {
        toast.error('This project title cannot be edited.')
        return
      }

      const title = String(data?.value).trim()
      if (title === getProjectDisplayName(project)) {
        return
      }

      return service.updateTitle(project, title)
    },
    args: {
      value: {
        displayName: 'Title',
        required: true,
        inputType: 'string',
        defaultValue: () => {
          const project = getCurrentProject()
          return project ? getProjectDisplayName(project) : ''
        },
        validation: async ({ data }) => validateProjectTitle(data),
      },
    },
  }
}
