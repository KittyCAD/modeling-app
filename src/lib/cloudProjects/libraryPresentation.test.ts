import { describeCloudLibrary } from '@src/lib/cloudProjects/libraryPresentation'
import { expect, it } from 'vitest'

it('describes personal libraries and storage controls', () => {
  const presentation = describeCloudLibrary({})
  expect(presentation.summaryDescription).toBe(
    'Projects in this library are saved to your Zoo account'
  )
  expect(presentation.detailsDescription).toContain(
    'Storage type and model-training controls depend on your plan.'
  )
})

it('describes organization ownership and editing access', () => {
  const presentation = describeCloudLibrary({
    organizationId: 'organization',
  })
  expect(presentation.summaryDescription).toBe(
    'Projects in this library are shared with your organization'
  )
  expect(presentation.detailsDescription).toBe(
    'Projects in this library belong to your organization. Editing access depends on project permissions.'
  )
})
