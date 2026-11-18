import { factory, provide } from 'plankton'
import { observations as editorInputs } from '@src/lib/editors/registry/contract'
import {
  observations as projectInputs,
  projectSourcesService,
} from '@src/lib/projectSession/next/contract'
import { createProjectSources } from '@src/lib/projectSession/next/sources'

/** Project and editor observations follow replacement while this source provider stays installed. */
const projectSources = factory({
  key: 'project-sources',
  dependencies: { editors: editorInputs, projects: projectInputs },
  create: ({ editors, projects }) => {
    const sources = createProjectSources(
      () => projects.projectSessionService.current.value,
      () => editors.editorsService.current.value?.editors.value ?? []
    )
    return {
      exports: sources,
      items: [provide(projectSourcesService, sources)],
    }
  },
})
export default projectSources
