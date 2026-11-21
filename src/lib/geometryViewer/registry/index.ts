import { computed, signal } from '@preact/signals-core'
import { contribute, factory } from 'plankton'
import { loadProjectEditor } from '@src/lib/editors/loadProjectEditor'
import {
  observations as editorInputs,
  editorLanguagesFacet,
  editorReadOnlyPoliciesFacet,
  editorViewsFacet,
} from '@src/lib/editors/registry/contract'
import { defineEditorView } from '@src/lib/editors/views'
import { executorCapabilityFacet } from '@src/lib/executors/registry/contract'
import fsZds from '@src/lib/fs-zds'
import { createGeometryExecution } from '@src/lib/geometryViewer/executor'
import {
  isGeometryFile,
  geometryPresentation,
} from '@src/lib/geometryViewer/formats'
import { GeometryViewer } from '@src/lib/geometryViewer/GeometryViewer'
import { insertGeometryImport } from '@src/lib/geometryViewer/insert'
import { sceneViews } from '@src/lib/kcl/modeling/sceneViews'
import { observations as projectInputs } from '@src/lib/projectSession/next/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import { observations as fileInputs } from '@src/registry/contracts/fileOperations'
import { isErr } from '@src/lib/trap'

/** Native CAD and mesh files have a read-only viewer; their storage bytes remain authoritative. */
const extension = factory({
  key: 'geometry-viewer',
  dependencies: {
    scenes: sceneViews,
    projects: projectInputs,
    editors: editorInputs,
    files: fileInputs,
  },
  create: ({ scenes, projects, editors, files }) => {
    const getProjects = () => projects.projectSessionService.current.value
    const revision = computed(
      () => getProjects()?.currentSession.value?.project.value.contents
    )
    const capability = createGeometryExecution(getProjects, revision)
    const view = defineEditorView((host) => {
      const scene = scenes.bind(capability, {
        presentation: geometryPresentation(host.editor.src.peek() ?? ''),
        version: '3.0',
      })(host)
      if (isErr(scene)) return scene
      const owner = getProjects()?.currentSession.peek()
      const targets = computed(() => {
        const session = getProjects()
        if (
          !owner ||
          session?.currentSession.value !== owner ||
          !owner.project.value.metadata.readWriteAccess
        )
          return []
        return session
          .listFiles()
          .filter(({ path }) => fsZds.extname(path).toLowerCase() === '.kcl')
          .map(({ path }) => ({
            path,
            label: fsZds.relative(owner.project.value.contents.path, path),
          }))
      })
      return {
        ...scene,
        targets,
        insert: async (path: string) => {
          const model = host.editor.src.peek()
          if (
            !owner ||
            owner.signal.aborted ||
            host.editor.signal.aborted ||
            getProjects()?.currentSession.peek() !== owner ||
            !model ||
            !targets.peek().some((target) => target.path === path)
          )
            return new Error(
              'The selected project files are no longer available'
            )
          const service = editors.editorsService.required()
          const target = await loadProjectEditor(
            path,
            service,
            getProjects,
            () => files.fileOperationsService.required(),
            { reuseExisting: true, signal: owner.signal }
          )
          if (isErr(target)) return target
          if (
            owner.signal.aborted ||
            host.editor.signal.aborted ||
            getProjects()?.currentSession.peek() !== owner ||
            host.editor.src.peek() !== model ||
            !getProjects()
              ?.listFiles()
              .some((file) => file.path === model)
          )
            return new Error('The selected model is no longer available')
          // Create the presentation before editing, so a failed view cannot leave an unseen edit.
          if (!service.views.peek().some((view) => view.editor === target)) {
            const view = service.createView(target)
            if (isErr(view)) return view
          }
          return insertGeometryImport(target, model)
        },
      }
    })({
      id: 'geometry.viewer',
      label: '3D Viewer',
      matches: ({ src }) => isGeometryFile(src),
      priority: 1000,
      Component: GeometryViewer,
    })
    return {
      items: [
        contribute(editorLanguagesFacet, () => ({
          id: 'geometry',
          storage: 'bytes' as const,
          matches: ({ src }) => isGeometryFile(src),
        })),
        contribute(editorReadOnlyPoliciesFacet, () => ({
          id: 'geometry.read-only',
          matches: ({ src }) => isGeometryFile(src),
          readOnly: signal(true),
        })),
        contribute(executorCapabilityFacet, () => capability),
        contribute(editorViewsFacet, () => view),
      ],
    }
  },
})
export default withProjectShellFeature(extension, 'geometry-viewer')
