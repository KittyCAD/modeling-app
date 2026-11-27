import type {
  ProjectLibrary,
  ProjectLibraryPresentation,
} from '@src/lib/projectLibraries'

export function describeCloudLibrary(
  library: Pick<ProjectLibrary, 'organizationId'>
): ProjectLibraryPresentation {
  return {
    summaryDescription: library.organizationId
      ? 'Projects in this library are shared with your organization'
      : 'Projects in this library are saved to your Zoo account',
    detailsDescription: library.organizationId
      ? 'Projects in this library belong to your organization. Editing access depends on project permissions.'
      : 'Projects in this library are saved to your Zoo account. Storage type and model-training controls depend on your plan.',
  }
}
