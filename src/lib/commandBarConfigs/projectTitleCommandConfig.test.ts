import {
  createProjectTitleCommand,
  PROJECT_TITLE_COMMAND_NAME,
  type ProjectTitleCommandService,
} from '@src/lib/commandBarConfigs/projectTitleCommandConfig'
import { MAX_PROJECT_NAME_LENGTH } from '@src/lib/constants'
import type { Project } from '@src/lib/project'
import { beforeEach, expect, test, vi } from 'vitest'

const project = {
  metadata: null,
  kcl_file_count: 1,
  directory_count: 0,
  title: 'Bracket',
  default_file: '/projects/bracket/main.kcl',
  path: '/projects/bracket',
  name: 'bracket',
  children: [],
  readWriteAccess: true,
} satisfies Project

function createService(): ProjectTitleCommandService {
  return {
    getTitle: vi.fn(() => 'Bracket'),
    canUpdateTitle: vi.fn(() => true),
    updateTitle: vi.fn().mockResolvedValue(undefined),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

test('is available as a project-only settings command', () => {
  const service = createService()
  const command = createProjectTitleCommand({
    getCurrentProject: () => project,
    service,
  })

  expect(command).toMatchObject({
    name: PROJECT_TITLE_COMMAND_NAME,
    displayName: 'Settings · project · title',
    groupId: 'settings',
  })
  const valueArgument = command?.args?.value
  expect(valueArgument?.inputType).toBe('string')
  if (valueArgument?.inputType === 'string') {
    expect(typeof valueArgument.defaultValue).toBe('function')
    if (typeof valueArgument.defaultValue === 'function') {
      expect(valueArgument.defaultValue({})).toBe('Bracket')
    }
  }
  expect(
    createProjectTitleCommand({
      getCurrentProject: () => undefined,
      service,
    })
  ).toBeNull()
})

test('is hidden and disabled when the current project title is read-only', () => {
  const service = createService()
  vi.mocked(service.canUpdateTitle).mockReturnValue(false)

  const command = createProjectTitleCommand({
    getCurrentProject: () => project,
    service,
  })

  expect(command).toMatchObject({
    disabled: true,
    hideFromSearch: true,
  })
})

test('updates the current project title', async () => {
  const service = createService()
  const command = createProjectTitleCommand({
    getCurrentProject: () => project,
    service,
  })

  await command?.onSubmit({ value: ' Updated bracket ' })

  expect(service.updateTitle).toHaveBeenCalledWith(project, 'Updated bracket')
})

test('validates title input', async () => {
  const command = createProjectTitleCommand({
    getCurrentProject: () => project,
    service: createService(),
  })
  const valueArgument = command?.args?.value
  expect(valueArgument?.inputType).toBe('string')
  if (valueArgument?.inputType !== 'string') {
    return
  }
  const validation = valueArgument.validation

  await expect(validation?.({ data: ' ', context: {} as never })).resolves.toBe(
    'Project title cannot be empty.'
  )
  await expect(
    validation?.({
      data: 'x'.repeat(MAX_PROJECT_NAME_LENGTH + 1),
      context: {} as never,
    })
  ).resolves.toContain(`${MAX_PROJECT_NAME_LENGTH} characters or fewer`)
})
