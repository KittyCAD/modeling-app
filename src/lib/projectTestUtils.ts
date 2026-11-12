import type { Project } from '@src/lib/project'
import { join } from 'path'

/** Minimal project metadata for editors whose tests need an owning project. */
export function createProjectForTest(
  path = 'some-project',
  overrides: Partial<Project> = {}
): Project {
  return {
    name: 'test',
    path,
    children: [],
    default_file: join(path, 'main.kcl'),
    directory_count: 0,
    kcl_file_count: 0,
    metadata: null,
    readWriteAccess: true,
    ...overrides,
  }
}
