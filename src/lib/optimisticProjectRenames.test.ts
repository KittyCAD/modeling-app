import {
  applyOptimisticProjectRenames,
  pruneSettledOptimisticProjectRenames,
} from '@src/lib/optimisticProjectRenames'
import type { Project } from '@src/lib/project'
import { describe, expect, it } from 'vitest'

const baseProject = {
  name: 'old-cloud-title',
  title: 'Old cloud title',
  cloudProjectId: 'project-123',
  path: '/projects/old-cloud-title',
  children: [],
  readWriteAccess: true,
  metadata: {
    created: 1,
    modified: 100,
    size: 32,
    accessed: null,
    type: null,
    permission: null,
  },
  kcl_file_count: 1,
  directory_count: 0,
  default_file: '/projects/old-cloud-title/main.kcl',
} satisfies Project

describe('optimistic project renames', () => {
  it('applies cloud project title and modified time overlays', () => {
    const projects = applyOptimisticProjectRenames([baseProject], {
      'project-123': {
        title: 'New cloud title',
        modified: 200,
      },
    })

    expect(projects?.[0]).toMatchObject({
      title: 'New cloud title',
      metadata: {
        modified: 200,
      },
    })
  })

  it('does not move a project modified time backward', () => {
    const projects = applyOptimisticProjectRenames(
      [
        {
          ...baseProject,
          metadata: {
            ...baseProject.metadata,
            modified: 300,
          },
        },
      ],
      {
        'project-123': {
          title: 'New cloud title',
          modified: 200,
        },
      }
    )

    expect(projects?.[0].metadata?.modified).toBe(300)
  })

  it('keeps overlays until the durable project title and modified time catch up', () => {
    expect(
      pruneSettledOptimisticProjectRenames([baseProject], {
        'project-123': {
          title: 'New cloud title',
          modified: 200,
        },
      })
    ).toEqual({
      'project-123': {
        title: 'New cloud title',
        modified: 200,
      },
    })

    expect(
      pruneSettledOptimisticProjectRenames(
        [
          {
            ...baseProject,
            metadata: {
              ...baseProject.metadata,
              modified: 200,
            },
          },
        ],
        {
          'project-123': {
            title: 'New cloud title',
            modified: 200,
          },
        }
      )
    ).toEqual({
      'project-123': {
        title: 'New cloud title',
        modified: 200,
      },
    })

    expect(
      pruneSettledOptimisticProjectRenames(
        [
          {
            ...baseProject,
            title: 'New cloud title',
            metadata: {
              ...baseProject.metadata,
              modified: 200,
            },
          },
        ],
        {
          'project-123': {
            title: 'New cloud title',
            modified: 200,
          },
        }
      )
    ).toEqual({})
  })
})
