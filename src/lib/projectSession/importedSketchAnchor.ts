import type { SourceRange } from '@rust/kcl-lib/bindings/SourceRange'
import type { ApiFile } from '@rust/kcl-lib/bindings/FrontendApi'
import { findUniqueName } from '@src/lang/create'
import type { KclManager } from '@src/lang/KclManager'
import { parse, resultIsOk } from '@src/lang/wasm'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { assertProjectPathWithoutSymlinks } from '@src/lib/fileSystem/projectPath'
import { getRelativePathIfContained } from '@src/lib/paths'
import { shouldInjectSelectionAnchors } from '@src/lib/selectionAnchors'
import type { ZookeeperSnapshotFileReplay } from '@src/lib/zookeeper/editorPlugin'

export async function planImportedSketchAnchor(
  manager: KclManager,
  face: { solidId: string; faceId: string },
  wasm: ModuleType
): Promise<
  | {
      edit: ZookeeperSnapshotFileReplay
      fileId: number
      anchor: string
      projectPath: string
    }
  | undefined
> {
  const { artifactGraph, variables } = manager
  const wall = artifactGraph.get(face.faceId)
  if (wall?.type !== 'wall') return
  const sweep = artifactGraph.get(wall.sweepId)
  if (sweep?.type !== 'sweep') return

  const bodies = Object.values(variables).flatMap((value) =>
    value?.type === 'Tuple' || value?.type === 'HomArray'
      ? value.value
      : [value]
  )
  const body = bodies.find(
    (value) => value?.type === 'Solid' && value.value.id === face.solidId
  )
  if (body?.type !== 'Solid') return
  if (body.value.historyAnchorGroups?.some(([id]) => id === face.faceId)) return
  const role = body.value.historyWalls?.find(([id]) => id === face.faceId)
  if (!role) return
  const source = body.value.historyExtrusionSources?.[role[1]]
  if (!source || source[2] !== sweep.codeRef.range[2]) return
  return planImportedRegionAnchor(manager, source, wasm)
}

export async function planImportedRegionAnchor(
  manager: KclManager,
  source: SourceRange,
  wasm: ModuleType
) {
  const project = manager.systemDeps.project.peek()
  if (!shouldInjectSelectionAnchors() || !project?.readWriteAccess) return
  const { execState, systemDeps } = manager
  const modulePath = execState.filenames[source[2]]
  if (modulePath?.type !== 'Local' || modulePath.value === manager.path) return
  const path = modulePath.value
  const relativePath = getRelativePathIfContained(project.path, path)
  if (!relativePath) return
  const ops = systemDeps.fileOperations
  if (!(await ops.canReadWrite(path))) return
  await assertProjectPathWithoutSymlinks(ops, project.path, path)
  const files: ApiFile[] = await manager.rustContext.getProjectState()
  const file = files.find((file) => file.path === path)
  if (!file) return
  const previousContent = new TextDecoder().decode(await ops.readFile(path))
  if (previousContent !== file.text) return
  const parsed = parse(previousContent, wasm)
  if (parsed instanceof Error || !resultIsOk(parsed)) return
  const calls = parsed.program.body.flatMap((statement) => {
    if (statement.type !== 'VariableDeclaration') return []
    const { id, init } = statement.declaration
    return init.type === 'CallExpressionKw' && !init.callee.path.length
      ? [{ name: id.name, call: init }]
      : []
  })
  const extrude = calls.find(
    ({ call }) =>
      call.callee.name.name === 'extrude' &&
      call.start <= source[0] &&
      source[1] <= call.end
  )
  const profile = extrude?.call.unlabeled
  if (profile?.type !== 'Name' || profile.path.length) return
  const regionName = profile.name.name
  const region = calls.find(
    ({ name, call }) =>
      name === regionName && call.callee.name.name === 'region'
  )
  if (
    !region ||
    region.call.arguments.some(({ label }) => label?.name === 'tag') ||
    calls.filter(
      ({ call }) =>
        call.callee.name.name === 'extrude' &&
        call.unlabeled?.type === 'Name' &&
        call.unlabeled.name.name === regionName
    ).length !== 1
  )
    return
  const anchor = findUniqueName(parsed.program, 'regionAnchor')
  const lastArgument = region.call.arguments.at(-1)
  if (!lastArgument) return
  const bytes = new TextEncoder().encode(previousContent)
  const offset = lastArgument.arg.end
  const decoder = new TextDecoder()
  const nextContent =
    decoder.decode(bytes.subarray(0, offset)) +
    `, tag = $${anchor}` +
    decoder.decode(bytes.subarray(offset))
  const result = parse(nextContent, wasm)
  if (result instanceof Error || !resultIsOk(result)) return
  return {
    projectPath: project.path,
    fileId: file.id,
    anchor,
    edit: { relativePath, absolutePath: path, previousContent, nextContent },
  }
}
