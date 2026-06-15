import type { HTMLProps } from 'react'
import { forwardRef } from 'react'

import { ActionButton } from '@src/components/ActionButton'
import Tooltip from '@src/components/Tooltip'
import { noAutofillFormProps, noAutofillInputProps } from '@src/lib/autofill'
import type { Project } from '@src/lib/project'
import { getProjectDisplayName } from '@src/lib/projectDisplayName'

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
      <form {...props} {...noAutofillFormProps}>
        <input
          {...noAutofillInputProps}
          className="min-w-0 dark:bg-chalkboard-80 dark:border-chalkboard-40 focus:outline-none"
          type="text"
          data-testid="project-rename-input"
          id="newProjectName"
          onClickCapture={(e) => e.preventDefault()}
          name="newProjectName"
          required
          defaultValue={getProjectDisplayName(project)}
          ref={ref}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              onDismiss()
            }
          }}
        />
        <div className="flex items-center gap-1">
          <ActionButton
            Element="button"
            type="submit"
            iconStart={{
              icon: 'checkmark',
              bgClassName: '!bg-transparent',
            }}
            className="!p-0"
          >
            <Tooltip position="left">Rename project</Tooltip>
          </ActionButton>
          <ActionButton
            Element="button"
            iconStart={{
              icon: 'close',
              iconClassName: 'dark:!text-chalkboard-20',
              bgClassName: '!bg-transparent',
            }}
            className="!p-0"
            onClick={onDismiss}
          >
            <Tooltip position="left">Cancel</Tooltip>
          </ActionButton>
        </div>
      </form>
    )
  }
)
