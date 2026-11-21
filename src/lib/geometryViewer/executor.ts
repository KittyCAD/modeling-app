import type { ReadonlySignal } from '@preact/signals-core'
import {
  defineExecutorCapability,
  type ExecutorRunContext,
} from '@src/lib/executors/registry/contract'
import fsZds from '@src/lib/fs-zds'
import { geometryImport, isGeometryFile } from '@src/lib/geometryViewer/formats'
import type { ProjectSessionService } from '@src/lib/projectSession/next/contract'
import { isErr } from '@src/lib/trap'

/** Captures original model bytes and glTF buffers in a virtual KCL program; no files are written. */
export function createGeometryExecution(
  getProjects: () => ProjectSessionService | undefined,
  revision: ReadonlySignal<unknown>
) {
  return defineExecutorCapability({
    id: 'geometry.preview',
    matches: ({ src }) => isGeometryFile(src),
    revision,
    async execute(_contents: string, { src, signal }: ExecutorRunContext) {
      const projects = getProjects()
      const session = projects?.currentSession.peek()
      const tree = session?.project.peek().contents
      if (!projects || !session || !tree)
        return new Error('Open a project to view this model')
      const paths = projects.listFiles().map((file) => file.path)
      if (!paths.includes(src))
        return new Error('The model is no longer in the project')
      const cancelled = () =>
        signal.aborted ||
        session.signal.aborted ||
        getProjects()?.currentSession.peek() !== session ||
        session.project.peek().contents !== tree
      const files = new Map<string, Uint8Array>()
      try {
        // The native glTF importer resolves external .bin buffers through this snapshot.
        for (const path of paths.filter(
          (path) =>
            path === src ||
            (fsZds.extname(src).toLowerCase() === '.gltf' &&
              fsZds.extname(path).toLowerCase() === '.bin')
        )) {
          if (cancelled()) return new Error('Model preview was cancelled')
          const bytes = await session.files.readBytes(
            fsZds.relative(tree.path, path)
          )
          if (cancelled()) return new Error('Model preview was cancelled')
          files.set(fsZds.join(path), bytes.slice())
        }
        let entrypoint = `${src}.viewer.kcl`
        while (paths.includes(entrypoint)) entrypoint += '.kcl'
        const statement = geometryImport(fsZds.basename(src), 'previewModel')
        if (isErr(statement)) return statement
        const program = `@settings(kclVersion = 3.0)\n${statement}\n`
        files.set(fsZds.join(entrypoint), new TextEncoder().encode(program))
        return { sources: { src: entrypoint, files } }
      } catch (cause) {
        return isErr(cause)
          ? cause
          : new Error('Unable to read the model', { cause })
      }
    },
  })
}
