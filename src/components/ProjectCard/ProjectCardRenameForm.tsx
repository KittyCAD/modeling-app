import { faX } from '@fortawesome/free-solid-svg-icons'
import { Project } from '@playwright/test'
import { ActionButton } from 'components/ActionButton'
import Tooltip from 'components/Tooltip'
import { HTMLProps, forwardRef } from 'react'

interface ProjectCardRenameFormProps extends HTMLProps<HTMLFormElement> {
  project: Project
  onDismiss: () => void
}

export const ProjectCardRenameForm = forwardRef(
  (
    { project, onDismiss, ...props }: ProjectCardRenameFormProps,
    ref: React.Ref<HTMLInputElement>
  ) => {
    return (
      <form {...props}>
        <input
          className="min-w-0 p-1 dark:bg-chalkboard-80 dark:border-chalkboard-40 focus:outline-none"
          type="text"
          id="newProjectName"
          name="newProjectName"
          autoCorrect="off"
          autoCapitalize="off"
          defaultValue={project.name}
          ref={ref}
        />
        <div className="flex items-center gap-1">
          <ActionButton
            Element="button"
            type="submit"
            iconStart={{
              icon: 'checkmark',
              size: 'sm',
              className: 'p-1',
              bgClassName: '!bg-transparent',
            }}
            className="!p-0"
          >
            <Tooltip position="left" delay={1000}>
              Rename project
            </Tooltip>
          </ActionButton>
          <ActionButton
            Element="button"
            iconStart={{
              icon: 'close',
              size: 'sm',
              iconClassName: 'dark:!text-chalkboard-20',
              bgClassName: '!bg-transparent',
              className: 'p-1',
            }}
            className="!p-0"
            onClick={onDismiss}
          >
            <Tooltip position="left" delay={1000}>
              Cancel
            </Tooltip>
          </ActionButton>
        </div>
      </form>
    )
  }
)
