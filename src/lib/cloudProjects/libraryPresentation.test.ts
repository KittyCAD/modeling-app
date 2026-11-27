import { describeCloudLibrary } from '@src/lib/cloudProjects/libraryPresentation'
import { expect, it } from 'vitest'

it('describes personal account storage and training controls', () => {
  const presentation = describeCloudLibrary({})
  expect(presentation.summaryDescription).toMatch(/account/i)
  expect(presentation.detailsDescription).toMatch(/training/i)
})

it('describes organization ownership and editing access', () => {
  const presentation = describeCloudLibrary({
    organizationId: 'organization',
  })
  expect(presentation.summaryDescription).toMatch(/organization/i)
  expect(presentation.detailsDescription).toMatch(/permissions/i)
})
