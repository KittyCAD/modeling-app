import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@e2e/playwright/zoo-test'
import type { SceneGraphDelta } from '@rust/kcl-lib/bindings/FrontendApi'

const fixtureDirectory = process.env.SELECT_ANYTHING_FIXTURE_DIR

const cases = [
  { fixture: 'body-split', output: 0, fragment: null },
  { fixture: 'body-split', output: 1, fragment: null },
  { fixture: 'face-split', output: 0, fragment: 0 },
  { fixture: 'face-split', output: 0, fragment: 1 },
  { fixture: 'edge-split', output: 0, fragment: 0 },
  { fixture: 'edge-split', output: 0, fragment: 1 },
] as const

for (const { fixture, output, fragment } of cases) {
  test(
    `fillets only the picked edge of ${fixture}, output ${output}, fragment ${fragment} @localRenderer`,
    {
      tag: ['@web', '@localRenderer'],
    },
    async ({ scene, page, editor, homePage, toolbar, modelingDialog }) => {
      test.skip(
        !fixtureDirectory || !process.env.SELECT_ANYTHING_ENGINE_AUDIT_LOG,
        'Requires the experimental local engine, its edge audit log, and fixtures'
      )
      const code = readFileSync(
        resolve(fixtureDirectory!, fixture + '.kcl'),
        'utf8'
      )
      await homePage.goToModelingScene()
      await scene.settled()
      await scene.waitForExecutionDoneAfter(() => editor.replaceCode('', code))
      await scene.moveCameraTo(
        { x: 65, y: -65, z: fixture === 'edge-split' ? -45 : 55 },
        { x: 20, y: 15, z: 5 }
      )

      const findPick = async () => {
        const entities = await scene.getProjectedEntities()
        const projected = entities.filter(
          (entity) => entity.kind === 'edge' && entity.visible
        )
        const result = await page.evaluate(
          async ({ edges, output, fragment, capKind }) => {
            const matches = new Map<
              string,
              ((typeof edges)[number] & { ownerId: string })[]
            >()
            const graph = window.app.singletons.kclManager.artifactGraph
            for (const edge of edges) {
              const response =
                await window.engineCommandManager.sendSceneCommand({
                  type: 'modeling_cmd_req',
                  cmd_id: crypto.randomUUID(),
                  cmd: { type: 'query_entity_type', entity_id: edge.id },
                })
              if (
                Array.isArray(response) ||
                !response ||
                !('resp' in response) ||
                response.resp.type !== 'modeling'
              )
                continue
              const payload = response.resp.data.modeling_response
              if (payload.type !== 'query_entity_type') continue
              const reference = payload.data.reference
              if (reference.type !== 'edge') continue
              const parent = reference.topology_fallback?.parent_id
              const owner = parent ? graph.get(parent) : undefined
              if (
                owner?.type !== 'compositeSolid' ||
                owner.outputIndex !== output
              )
                continue
              const sources = owner.subtractionFaceSources ?? {}
              const picked = { ...edge, ownerId: owner.id }
              if (fragment === null) {
                if (
                  reference.side_faces.some(
                    (id) => sources[id] && sources[id] !== id
                  )
                )
                  return picked
                continue
              }

              // The two halves share source faces across the notch.
              const sourceFaces = reference.side_faces.map(
                (id) => sources[id] ?? id
              )
              if (
                !sourceFaces.some((id) => {
                  const artifact = graph.get(id)
                  return (
                    artifact?.type === 'cap' && artifact.subType === capKind
                  )
                })
              )
                continue
              const key = sourceFaces.sort().join(',')
              const siblings = matches.get(key) ?? []
              siblings.push(picked)
              matches.set(key, siblings)
            }
            const siblings = [...matches.values()].find(
              (edges) => edges.length === 2
            )
            return siblings?.sort((a, b) => a.x - b.x)[fragment ?? 0] ?? null
          },
          {
            edges: projected,
            output,
            fragment,
            capKind: fixture === 'edge-split' ? 'start' : 'end',
          }
        )
        if (!result)
          console.info(
            'Projected targets:',
            entities.length,
            'visible edges:',
            projected.length
          )
        return result
      }

      let pick: Awaited<ReturnType<typeof findPick>> = null
      await expect
        .poll(async () => {
          pick = await findPick()
          return pick !== null
        })
        .toBe(true)
      if (!pick) throw new Error('No visible edge with split provenance')
      const { x, y, id, ownerId } = pick as NonNullable<
        Awaited<ReturnType<typeof findPick>>
      >
      await page.mouse.click(x, y)
      await toolbar.expectSelection('1 edge')
      await toolbar.filletButton.click()
      await expect(modelingDialog.selection('Selection')).toHaveText('1 edge')
      await modelingDialog.fillInput('radius', '0.2')
      await scene.waitForExecutionDoneAfter(() => modelingDialog.submit())
      await expect(
        page.locator('.cm-content[data-language="kcl"]')
      ).toContainText(new RegExp(`fillet\\(\\s*result\\[${output}\\]`))
      await editor.expectEditor.toContain('sideFaces')
      if (fragment !== null) {
        await editor.expectEditor.toContain('endFaces')
      }
      await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
      const auditLog = process.env.SELECT_ANYTHING_ENGINE_AUDIT_LOG
      if (auditLog) {
        const cutTargets = readFileSync(auditLog, 'utf8')
          .split('\n')
          .filter((line) => line.startsWith('SELECT_ANYTHING_CUT_TARGETS '))
          .map((line) =>
            JSON.parse(line.slice('SELECT_ANYTHING_CUT_TARGETS '.length))
          )
        expect(cutTargets.at(-1)).toEqual({ body: ownerId, edges: [id] })
      }
    }
  )
}

for (const output of [0, 1]) {
  test(
    `sketches on the top face of body-split output ${output} @localRenderer`,
    { tag: ['@web', '@localRenderer'] },
    async ({ scene, page, editor, homePage, toolbar }) => {
      test.skip(
        !fixtureDirectory,
        'Requires the experimental engine and fixtures'
      )
      const fixtureCode = readFileSync(
        resolve(fixtureDirectory!, 'body-split.kcl'),
        'utf8'
      )
      const code =
        output === 0
          ? fixtureCode
          : fixtureCode.replace(
              'length = 10mm)',
              'length = 10mm, tagEnd = $originalTop)'
            )
      await homePage.goToModelingScene()
      await scene.settled()
      await scene.waitForExecutionDoneAfter(() => editor.replaceCode('', code))
      await scene.moveCameraTo({ x: 65, y: -65, z: 55 }, { x: 20, y: 15, z: 5 })

      const findFace = async () => {
        const points = (await scene.getProjectedEntities()).filter(
          (point) => point.visible && point.kind === 'bodyFace'
        )
        return page.evaluate(
          async ({ points, output }) => {
            const graph = window.app.singletons.kclManager.artifactGraph
            for (const point of points) {
              const reply = await window.engineCommandManager.sendSceneCommand({
                type: 'modeling_cmd_req',
                cmd_id: crypto.randomUUID(),
                cmd: { type: 'query_entity_type', entity_id: point.id },
              })
              if (
                !reply ||
                Array.isArray(reply) ||
                !('resp' in reply) ||
                reply.resp.type !== 'modeling'
              )
                continue
              const response = reply.resp.data.modeling_response
              if (response.type !== 'query_entity_type') continue
              const ref = response.data.reference
              if (ref.type !== 'face' || !ref.topology_fallback) continue
              const owner = graph.get(ref.topology_fallback.parent_id)
              if (
                owner?.type !== 'compositeSolid' ||
                owner.outputIndex !== output
              )
                continue
              const source = graph.get(
                owner.subtractionFaceSources?.[point.id] ?? point.id
              )
              if (source?.type === 'cap' && source.subType === 'end')
                return point
            }
            return null
          },
          { points, output }
        )
      }

      let pick: Awaited<ReturnType<typeof findFace>> = null
      await expect
        .poll(async () => {
          pick = await findFace()
          return pick !== null
        })
        .toBe(true)
      if (!pick)
        throw new Error('No visible top face on the subtraction output')
      const { x, y } = pick as NonNullable<Awaited<ReturnType<typeof findFace>>>
      await page.mouse.click(x, y)
      await toolbar.expectSelection('1 face')
      await toolbar.startSketchBtn.click()
      await expect(toolbar.exitSketchBtn).toBeEnabled()
      const editorContent = page.locator('.cm-content[data-language="kcl"]')
      const capRef = output === 0 ? 'END' : 'result[1].faces.originalTop'
      await expect(editorContent).toContainText(
        `faceOf(result[${output}], face = ${capRef})`
      )
      await expect(editorContent).not.toContainText('faceId(')
      await toolbar.exitSketch()
      await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
    }
  )
}

async function replayFillet(
  page: Page,
  input: {
    main: string
    generated: string
    mainPath: string
    producerFile?: { path: string; text: string }
    length: number | null
    outputIndex?: number
    edgeX?: number
    point?: { x: number; y: number; z: number }
  }
) {
  return await page.evaluate(
    async ({
      main,
      generated,
      mainPath,
      producerFile,
      length,
      outputIndex = 0,
      edgeX,
      point,
    }) => {
      const { rustContext, wasmInstancePromise } =
        window.app.singletons.kclManager
      const wasm = await wasmInstancePromise
      const parse = (code: string) => {
        const [program, issues] = wasm.parse_wasm(code)
        if (!program) throw new Error(JSON.stringify(issues))
        return program
      }
      await rustContext.sendOpenProject(mainPath, [
        { id: 0, path: mainPath, text: main },
        ...(producerFile ? [{ id: 1, ...producerFile }] : []),
      ])
      await rustContext.clearSceneAndBustCache({}, mainPath)
      const before = await rustContext.execute(parse(main), {}, mainPath)
      const finished = before.variables.finished
      const body =
        finished?.type === 'HomArray' ? finished.value[outputIndex] : undefined
      if (body?.type !== 'Solid') throw new Error('Missing edited output body')
      let expectedEdge: string | null = null
      if (length !== null) {
        const send = window.engineCommandManager.sendSceneCommand.bind(
          window.engineCommandManager
        )
        const response = await send({
          type: 'modeling_cmd_req',
          cmd_id: crypto.randomUUID(),
          cmd: {
            type: 'closest_edge',
            object_id: body.value.id,
            closest_to: point ?? { x: 4, y: 0, z: 10 },
          },
        })
        if (
          !response ||
          Array.isArray(response) ||
          !('resp' in response) ||
          response.resp.type !== 'modeling' ||
          response.resp.data.modeling_response.type !== 'closest_edge'
        ) {
          throw new Error('Could not find the surviving front-wall edge')
        }
        expectedEdge = response.resp.data.modeling_response.data.edge_id ?? null
        if (!expectedEdge)
          throw new Error('Missing the surviving front-wall edge')
        if (edgeX !== undefined) {
          const endpoints = await send({
            type: 'modeling_cmd_req',
            cmd_id: crypto.randomUUID(),
            cmd: { type: 'curve_get_end_points', curve_id: expectedEdge },
          })
          if (
            !endpoints ||
            Array.isArray(endpoints) ||
            !('resp' in endpoints) ||
            endpoints.resp.type !== 'modeling' ||
            endpoints.resp.data.modeling_response.type !==
              'curve_get_end_points'
          ) {
            throw new Error('Could not verify the position of the replay edge')
          }
          const { start, end } = endpoints.resp.data.modeling_response.data
          if (
            Math.abs(start.x - edgeX) > 0.0001 ||
            Math.abs(end.x - edgeX) > 0.0001
          ) {
            throw new Error(
              `The edge was at x = ${start.x} to ${end.x}, expected ${edgeX}`
            )
          }
        }
        const measured = await send({
          type: 'modeling_cmd_req',
          cmd_id: crypto.randomUUID(),
          cmd: { type: 'edge_get_length', edge_id: expectedEdge },
        })
        if (
          !measured ||
          Array.isArray(measured) ||
          !('resp' in measured) ||
          measured.resp.type !== 'modeling' ||
          measured.resp.data.modeling_response.type !== 'edge_get_length' ||
          Math.abs(measured.resp.data.modeling_response.data.length - length) >
            0.0001
        ) {
          throw new Error(
            'The independently picked edge has an unexpected length'
          )
        }
      }
      const names =
        finished?.type === 'HomArray'
          ? finished.value.map((value) =>
              value.type === 'Solid'
                ? (value.value.booleanOutputNames ?? [])
                : []
            )
          : []
      try {
        await rustContext.execute(parse(generated), {}, mainPath)
        return { body: body.value.id, expectedEdge, error: null, names }
      } catch (error) {
        return {
          body: body.value.id,
          expectedEdge,
          names,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
    input
  )
}

function addReplayCut(
  producer: string,
  [x0, x1, y0, y1]: [number, number, number, number]
) {
  return (
    producer.replace('export finished = subtract', 'secondCut = subtract') +
    `
replaySketch = sketch(on = XY) {
  a = line(start = [${x0}mm, ${y0}mm], end = [${x1}mm, ${y0}mm])
  b = line(start = [${x1}mm, ${y0}mm], end = [${x1}mm, ${y1}mm])
  c = line(start = [${x1}mm, ${y1}mm], end = [${x0}mm, ${y1}mm])
  d = line(start = [${x0}mm, ${y1}mm], end = [${x0}mm, ${y0}mm])
}
replayRegion = region(segments = [replaySketch.a, replaySketch.b, replaySketch.c, replaySketch.d])
replayTool = extrude(replayRegion, length = 14mm) |> translate(z = -2mm)
export finished = subtract(secondCut[0], tools = [replayTool], separateBodies = true)
`
  )
}

for (const kind of [
  'end face',
  'sides only',
  'expanded sides',
  'ambiguous sides',
  'producer replay',
  'editable add anchor',
  'editable reuse anchor',
  'editable history only',
] as const) {
  const editable = kind.startsWith('editable ')
  const sideOnly =
    !editable && kind !== 'end face' && kind !== 'producer replay'
  test(
    `fillets the clicked edge through a two-cut ${editable ? 'producer' : 'import'} (${kind}) @localRenderer`,
    { tag: ['@web', '@localRenderer'] },
    async (
      {
        scene,
        page,
        editor,
        homePage,
        toolbar,
        modelingDialog,
        folderSetupFn,
        fs,
      },
      testInfo
    ) => {
      const auditLog = process.env.SELECT_ANYTHING_ENGINE_AUDIT_LOG
      test.skip(
        !fixtureDirectory || !auditLog,
        'Requires the local lineage engine and fixtures'
      )
      const consumer = readFileSync(
        resolve(fixtureDirectory!, 'lineage-two-cut-main.kcl'),
        'utf8'
      )
      const part = readFileSync(
        resolve(fixtureDirectory!, 'lineage-two-cut-part.kcl'),
        'utf8'
      )
      const main = !editable
        ? consumer
        : kind === 'editable reuse anchor'
          ? part.replace(
              /^baseRegion = region\((.*)\)$/m,
              'baseRegion = region($1, tag = $baseProfile)'
            )
          : part
      const projectName = 'two-cut-lineage'
      const partName = 'lineage-two-cut-part.kcl'
      const { dir } = await folderSetupFn(async (root) => {
        const project = await fs.join(root, projectName)
        await fs.mkdir(project, { recursive: true })
        const encoder = new TextEncoder()
        await fs.writeFile(
          await fs.join(project, 'main.kcl'),
          encoder.encode(main)
        )
        await fs.writeFile(
          await fs.join(project, partName),
          encoder.encode(part)
        )
      })
      await homePage.openProject(projectName)
      await scene.settled()
      await page.reload()
      await scene.settled()
      await scene.moveCameraTo({ x: 65, y: -65, z: 55 }, { x: 14, y: 9, z: 5 })
      if (kind === 'end face') {
        const visible = new Set<string>()
        for (const camera of [
          { x: 65, y: -65, z: 55 },
          { x: -65, y: -65, z: -45 },
          { x: -65, y: 75, z: 55 },
          { x: 80, y: 75, z: -45 },
        ]) {
          await scene.moveCameraTo(camera, { x: 20, y: 15, z: 5 })
          for (const entity of await scene.getProjectedEntities()) {
            if (entity.kind === 'edge' && entity.visible) visible.add(entity.id)
          }
        }
        const edges = await page.evaluate(
          async (ids) => {
            const { variables } = window.app.singletons.kclManager
            const finished = variables.finished
            const body =
              finished?.type === 'HomArray' ? finished.value[0] : undefined
            if (body?.type !== 'Solid')
              throw new Error('Missing imported output')
            const groups = body.value.historyFaceGroups ?? []
            const rows = []
            for (const id of ids) {
              const reply = await window.engineCommandManager.sendSceneCommand({
                type: 'modeling_cmd_req',
                cmd_id: crypto.randomUUID(),
                cmd: { type: 'query_entity_type', entity_id: id },
              })
              if (
                !reply ||
                Array.isArray(reply) ||
                !('resp' in reply) ||
                reply.resp.type !== 'modeling'
              )
                continue
              const response = reply.resp.data.modeling_response
              if (response.type !== 'query_entity_type') continue
              const ref = response.data.reference
              if (
                ref.type !== 'edge' ||
                ref.topology_fallback?.parent_id !== body.value.id
              )
                continue
              const describe = (face: string) => {
                const member = groups.find(([id]) => id === face)
                if (!member) return null
                const [, extrusion, collection, property] = member
                const faces = new Set(
                  groups
                    .filter(
                      ([, e, c, p]) =>
                        e === extrusion && c === collection && p === property
                    )
                    .map(([id]) => id)
                )
                return { extrusion, collection, property, faces: [...faces] }
              }
              const sides = ref.side_faces.map(describe)
              const ends = (ref.end_faces ?? []).map(describe)
              let expandedMatches: string[] | undefined
              if (
                sides.length === 2 &&
                sides[0] &&
                sides[1] &&
                sides.some((group) => group && group.faces.length > 1) &&
                !ends.length &&
                ref.index == null
              ) {
                const pairs = sides[0].faces.flatMap((first) =>
                  sides[1]!.faces.map((second): [string, string] => [
                    first,
                    second,
                  ])
                )
                const replies = await Promise.all(
                  pairs.map((face_ids) => {
                    const cmd = {
                      type: 'solid3d_get_common_edge' as const,
                      object_id: body.value.id,
                      face_ids,
                      all: true,
                    }
                    return window.engineCommandManager.sendSceneCommand({
                      type: 'modeling_cmd_req',
                      cmd_id: crypto.randomUUID(),
                      cmd,
                    })
                  })
                )
                expandedMatches = [
                  ...new Set(
                    replies.flatMap((reply) => {
                      if (
                        !reply ||
                        Array.isArray(reply) ||
                        !('resp' in reply) ||
                        reply.resp.type !== 'modeling'
                      )
                        throw new Error(
                          'Could not resolve the expanded edge sides'
                        )
                      const payload = reply.resp.data.modeling_response
                      if (
                        payload.type !== 'solid3d_get_common_edge' ||
                        !('edges' in payload.data) ||
                        !Array.isArray(payload.data.edges)
                      )
                        throw new Error(
                          'The engine omitted the common-edge matches'
                        )
                      return payload.data.edges as string[]
                    })
                  ),
                ]
              }
              rows.push({
                id,
                index: ref.index ?? null,
                sides,
                ends,
                expandedMatches,
              })
            }
            return rows
          },
          [...visible]
        )
        expect(edges.length).toBeGreaterThan(1)
        const expanded = edges.filter((edge) => edge.expandedMatches)
        expect(expanded).toHaveLength(8)
        for (const edge of expanded)
          expect(edge.expandedMatches).toContain(edge.id)
        expect(
          expanded.filter((edge) => edge.expandedMatches?.length === 1)
        ).toHaveLength(6)
        expect(
          expanded.filter((edge) => edge.expandedMatches?.length === 3)
        ).toHaveLength(2)
        await testInfo.attach('two-cut-edge-inventory', {
          body: JSON.stringify(edges, null, 2),
          contentType: 'application/json',
        })
        await scene.moveCameraTo(
          { x: 65, y: -65, z: 55 },
          { x: 14, y: 9, z: 5 }
        )
      }
      const findPick = async () => {
        const projected = (await scene.getProjectedEntities()).filter(
          (entity) => entity.kind === 'edge' && entity.visible
        )
        return page.evaluate(
          async ({ edges, sideOnly, kind }) => {
            const graph = window.app.singletons.kclManager.artifactGraph
            for (const edge of edges) {
              const response =
                await window.engineCommandManager.sendSceneCommand({
                  type: 'modeling_cmd_req',
                  cmd_id: crypto.randomUUID(),
                  cmd: { type: 'query_entity_type', entity_id: edge.id },
                })
              if (
                !response ||
                Array.isArray(response) ||
                !('resp' in response) ||
                response.resp.type !== 'modeling'
              )
                continue
              const payload = response.resp.data.modeling_response
              if (payload.type !== 'query_entity_type') continue
              const ref = payload.data.reference
              if (ref.type !== 'edge' || !ref.topology_fallback) continue
              const owner = graph.get(ref.topology_fallback.parent_id)
              if (owner?.type !== 'compositeSolid' || owner.consumed) continue
              if (sideOnly) {
                const finished =
                  window.app.singletons.kclManager.variables.finished
                const body =
                  finished?.type === 'HomArray' ? finished.value[0] : undefined
                if (body?.type !== 'Solid' || body.value.id !== owner.id)
                  continue
                const groups = body.value.historyFaceGroups ?? []
                if (
                  ref.index != null ||
                  ref.end_faces?.length ||
                  ref.side_faces.length !== 2
                )
                  continue
                const sides = ref.side_faces.map((faceId) => {
                  const group = groups.find(([id]) => id === faceId)
                  if (!group) return null
                  const [, e, c, m] = group
                  return {
                    collection: c,
                    size: new Set(
                      groups
                        .filter(
                          ([, ee, cc, mm]) => ee === e && cc === c && mm === m
                        )
                        .map(([id]) => id)
                    ).size,
                  }
                })
                const expanded = sides.some((group) => group && group.size > 1)
                const eligible =
                  kind === 'expanded sides'
                    ? expanded &&
                      sides.every((group) => group?.collection === 'wallFaces')
                    : kind === 'ambiguous sides'
                      ? expanded &&
                        sides.some((group) => group?.collection === 'capFaces')
                      : sides.every((group) => group?.size === 1)
                if (eligible) return { ...edge, ownerId: owner.id }
                continue
              }
              const first = graph.get(owner.solidIds[0])
              const current = owner.subtractionFaceIdentityLineage?.sources
              if (!current || first?.type !== 'compositeSolid') continue
              const previous = first.subtractionFaceIdentityLineage?.sources
              if (!previous) continue
              const baseFaces = ref.side_faces.map((id) => {
                const immediate = current[id]
                const origin = immediate && previous[immediate]
                return origin ? graph.get(origin) : undefined
              })
              if (
                !baseFaces.some(
                  (face) => face?.type === 'cap' && face.subType === 'end'
                )
              )
                continue
              if (
                !baseFaces.some((face) => {
                  if (face?.type !== 'wall') return false
                  const sweep = graph.get(face.sweepId)
                  const path =
                    sweep?.type === 'sweep' &&
                    sweep.pathId &&
                    graph.get(sweep.pathId)
                  return (
                    !!path &&
                    path.type === 'path' &&
                    path.segIds[0] === face.segId
                  )
                })
              )
                continue
              const endsAtSecondNotch = ref.end_faces?.some((id) => {
                const source = current[id]
                const wall = source ? graph.get(source) : undefined
                if (wall?.type !== 'wall') return false
                const sweep = graph.get(wall.sweepId)
                if (
                  sweep?.type !== 'sweep' ||
                  !sweep.pathId ||
                  !owner.toolIds.includes(sweep.pathId)
                )
                  return false
                const path = graph.get(sweep.pathId)
                return path?.type === 'path' && path.segIds[3] === wall.segId
              })
              if (endsAtSecondNotch) return { ...edge, ownerId: owner.id }
            }
            return null
          },
          { edges: projected, sideOnly, kind }
        )
      }

      let pick: Awaited<ReturnType<typeof findPick>> = null
      await expect
        .poll(async () => {
          pick = await findPick()
          return pick !== null
        })
        .toBe(true)
      if (!pick) throw new Error('Missing the visible second-notch fragment')
      const { id, ownerId, x, y } = pick as NonNullable<
        Awaited<ReturnType<typeof findPick>>
      >
      if (kind === 'producer replay') {
        const originalEdge = await page.evaluate(async (object_id) => {
          const reply = await window.engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: crypto.randomUUID(),
            cmd: {
              type: 'closest_edge',
              object_id,
              closest_to: { x: 4, y: 0, z: 10 },
            },
          })
          if (
            !reply ||
            Array.isArray(reply) ||
            !('resp' in reply) ||
            reply.resp.type !== 'modeling'
          )
            return null
          const response = reply.resp.data.modeling_response
          return response.type === 'closest_edge' ? response.data.edge_id : null
        }, ownerId)
        expect(originalEdge).toBe(id)
      }
      if (kind === 'editable history only') {
        await page.getByRole('checkbox', { name: 'Inject anchors' }).uncheck()
      }
      await page.mouse.click(x, y)
      await toolbar.expectSelection('1 edge')
      await toolbar.filletButton.click()
      await modelingDialog.fillInput('radius', '0.2')
      const offset = readFileSync(auditLog!, 'utf8').length
      if (kind === 'ambiguous sides') {
        await modelingDialog.submitButton.click()
        await expect(
          page.getByText(/The named side faces match 3 edges/).first()
        ).toBeVisible()
        await expect(
          page.locator('.cm-content[data-language="kcl"]')
        ).not.toContainText('fillet(')
        expect(readFileSync(auditLog!, 'utf8').slice(offset)).not.toContain(
          'SELECT_ANYTHING_CUT_TARGETS'
        )
        return
      }
      await scene.waitForExecutionDoneAfter(() => modelingDialog.submit())
      await expect(
        page.locator('.cm-content[data-language="kcl"]')
      ).toContainText(/fillet\(\s*finished\[0\]/)
      if (sideOnly) {
        await editor.expectEditor.toContain('finished[0].history.extrusions[')
        await editor.expectEditor.toContain('endFaces = []')
      } else if (!editable || kind === 'editable history only') {
        await editor.expectEditor.toContain(
          'finished[0].history.extrusions[0].wallFaces.side0'
        )
        await editor.expectEditor.toContain(
          'finished[0].history.extrusions[0].capFaces.end'
        )
        await editor.expectEditor.toContain(
          'finished[0].history.extrusions[2].wallFaces.side3'
        )
      }
      await expect(
        page.locator('.cm-content[data-language="kcl"]')
      ).not.toContainText('cutDepth')
      await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
      const targets = readFileSync(auditLog!, 'utf8')
        .slice(offset)
        .split('\n')
        .filter((line) => line.startsWith('SELECT_ANYTHING_CUT_TARGETS '))
        .map((line) =>
          JSON.parse(line.slice('SELECT_ANYTHING_CUT_TARGETS '.length))
        )
      expect(targets).toEqual([{ body: ownerId, edges: [id] }])
      const savedPart = await fs.join(await fs.join(dir, projectName), partName)
      expect(new TextDecoder().decode(await fs.readFile(savedPart))).toBe(part)

      if (kind === 'editable history only') {
        await expect(
          page.locator('.cm-content[data-language="kcl"]')
        ).not.toContainText('tag = $')
      } else if (editable) {
        const generated = await page.evaluate(
          () => window.app.singletons.kclManager.code
        )
        const anchor =
          kind === 'editable reuse anchor' ? 'baseProfile' : 'regionAnchor001'
        expect(generated.match(/tag = \$[A-Za-z0-9_]+/g)).toEqual([
          `tag = $${anchor}`,
        ])
        const split = generated.search(/\n\w+ = fillet\(/)
        expect(split).toBeGreaterThan(0)
        const producer = generated.slice(0, split)
        const savedFillet = generated.slice(split)
        expect(savedFillet).toContain(
          `finished[0].anchors.${anchor}.wallFaces.side0`
        )
        expect(savedFillet).toContain(
          `finished[0].anchors.${anchor}.capFaces.end`
        )
        const renamed = producer
          .replace('base = extrude(', 'renamedBase = extrude(')
          .replace('subtract([base]', 'subtract([renamedBase]')
        expect(renamed).toContain('renamedBase = extrude(')
        const mainPath = await fs.join(
          await fs.join(dir, projectName),
          'main.kcl'
        )
        await expect
          .poll(async () =>
            new TextDecoder().decode(await fs.readFile(mainPath))
          )
          .toBe(generated)
        await fs.writeFile(
          mainPath,
          new TextEncoder().encode(renamed + savedFillet)
        )
        const replayOffset = readFileSync(auditLog!, 'utf8').length
        const result = await replayFillet(page, {
          main: renamed,
          generated: renamed + savedFillet,
          mainPath,
          length: 5,
        })
        expect(result.error).toBeNull()
        const replayTargets = readFileSync(auditLog!, 'utf8')
          .slice(replayOffset)
          .split('\n')
          .filter((line) => line.startsWith('SELECT_ANYTHING_CUT_TARGETS '))
          .map((line) =>
            JSON.parse(line.slice('SELECT_ANYTHING_CUT_TARGETS '.length))
          )
        expect(replayTargets).toEqual([
          { body: result.body, edges: [result.expectedEdge] },
        ])
      }

      if (kind === 'producer replay') {
        const generated = await page.evaluate(
          () => window.app.singletons.kclManager.code
        )
        const mainPath = await fs.join(
          await fs.join(dir, projectName),
          'main.kcl'
        )
        const variants = [
          { name: 'unrelated cut', bounds: [29, 33, 26, 34], length: 5 },
          { name: 'wall split', bounds: [1, 3, -5, 2], length: 2 },
          { name: 'deleted face', bounds: [3, 11, -5, 3], length: null },
        ] as const

        for (const variant of variants) {
          await test.step(variant.name, async () => {
            const producer = addReplayCut(part, [...variant.bounds])
            await fs.writeFile(savedPart, new TextEncoder().encode(producer))
            const replayOffset = readFileSync(auditLog!, 'utf8').length
            const result = await replayFillet(page, {
              main,
              generated,
              mainPath,
              producerFile: { path: savedPart, text: producer },
              length: variant.length,
            })
            const replayTargets = readFileSync(auditLog!, 'utf8')
              .slice(replayOffset)
              .split('\n')
              .filter((line) => line.startsWith('SELECT_ANYTHING_CUT_TARGETS '))
              .map((line) =>
                JSON.parse(line.slice('SELECT_ANYTHING_CUT_TARGETS '.length))
              )
            if (variant.length === null) {
              expect(result.error).toContain("No live faces named 'side3'")
              expect(replayTargets).toEqual([])
            } else {
              expect(result.error).toBeNull()
              expect(replayTargets).toEqual([
                { body: result.body, edges: [result.expectedEdge] },
              ])
            }
          })
        }
      }
    }
  )
}

test(
  'replays a fillet on a named Boolean output after the order changes @localRenderer',
  { tag: ['@web', '@localRenderer'] },
  async ({
    scene,
    page,
    homePage,
    toolbar,
    modelingDialog,
    folderSetupFn,
    fs,
  }) => {
    const auditLog = process.env.SELECT_ANYTHING_ENGINE_AUDIT_LOG
    test.skip(
      !fixtureDirectory || !auditLog,
      'Requires the local lineage engine and fixtures'
    )
    const projectName = 'named-output'
    const partName = 'named-output-part.kcl'
    const main = readFileSync(
      resolve(fixtureDirectory!, 'named-output-main.kcl'),
      'utf8'
    )
    const part = readFileSync(resolve(fixtureDirectory!, partName), 'utf8')
    const encoder = new TextEncoder()
    const { dir } = await folderSetupFn(async (root) => {
      const project = await fs.join(root, projectName)
      await fs.mkdir(project, { recursive: true })
      await fs.writeFile(
        await fs.join(project, 'main.kcl'),
        encoder.encode(main)
      )
      await fs.writeFile(await fs.join(project, partName), encoder.encode(part))
    })
    const project = await fs.join(dir, projectName)
    const mainPath = await fs.join(project, 'main.kcl')
    const partPath = await fs.join(project, partName)

    await homePage.openProject(projectName)
    await scene.settled()
    await page.reload()
    await scene.settled()
    await scene.moveCameraTo({ x: -65, y: -65, z: 55 }, { x: 12, y: 15, z: 5 })
    const point = { x: 0, y: 15, z: 10 }
    const original = await page.evaluate(async (point) => {
      const finished = window.app.singletons.kclManager.variables.finished
      if (finished?.type !== 'HomArray' || finished.value.length !== 2)
        throw new Error('The initial cut did not produce two solids')
      const index = finished.value.findIndex(
        (item) =>
          item.type === 'Solid' &&
          item.value.booleanOutputNames?.includes('left')
      )
      const body = finished.value[index]
      if (body?.type !== 'Solid')
        throw new Error('The left wall did not resolve to an output')
      const reply = await window.engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: crypto.randomUUID(),
        cmd: {
          type: 'closest_edge',
          object_id: body.value.id,
          closest_to: point,
        },
      })
      if (
        !reply ||
        Array.isArray(reply) ||
        !('resp' in reply) ||
        reply.resp.type !== 'modeling'
      )
        throw new Error('Could not pick the left edge by position')
      const result = reply.resp.data.modeling_response
      if (result.type !== 'closest_edge' || !result.data.edge_id)
        throw new Error('Could not pick the left edge by position')
      return { index, body: body.value.id, edge: result.data.edge_id }
    }, point)
    type Projected = Awaited<
      ReturnType<typeof scene.getProjectedEntities>
    >[number]
    let pick: Projected | undefined
    await expect
      .poll(async () => {
        pick = (await scene.getProjectedEntities()).find(
          (candidate) => candidate.visible && candidate.id === original.edge
        )
        return pick?.id
      })
      .toBe(original.edge)
    if (!pick) throw new Error('The left edge is not visible')
    await page.mouse.click(pick.x, pick.y)
    await toolbar.expectSelection('1 edge')
    await toolbar.filletButton.click()
    await modelingDialog.fillInput('radius', '0.2')
    const readTargets = (offset: number) =>
      readFileSync(auditLog!, 'utf8')
        .slice(offset)
        .split('\n')
        .filter((line) => line.startsWith('SELECT_ANYTHING_CUT_TARGETS '))
        .map((line) =>
          JSON.parse(line.slice('SELECT_ANYTHING_CUT_TARGETS '.length))
        )
    const originalOffset = readFileSync(auditLog!, 'utf8').length
    await scene.waitForExecutionDoneAfter(() => modelingDialog.submit())
    const generated = await page.evaluate(
      () => window.app.singletons.kclManager.code
    )
    expect(generated).toMatch(/fillet\(\s*finished.outputs.left/)
    expect(generated).not.toMatch(/finished\[\d+\]/)
    expect(readTargets(originalOffset)).toEqual([
      { body: original.body, edges: [original.edge] },
    ])
    await expect
      .poll(async () => new TextDecoder().decode(await fs.readFile(mainPath)))
      .toBe(generated)

    // Change only the output order and preserve any anchor injected by Fillet.
    const savedProducer = new TextDecoder().decode(await fs.readFile(partPath))
    const reversed = savedProducer.replace(
      'export finished = split',
      'export finished = [split[1], split[0]]'
    )
    expect(reversed).not.toBe(savedProducer)
    await fs.writeFile(partPath, encoder.encode(reversed))
    const reorderedOffset = readFileSync(auditLog!, 'utf8').length
    const reordered = await replayFillet(page, {
      main,
      generated,
      mainPath,
      length: 30,
      point,
      outputIndex: 1 - original.index,
      edgeX: 0,
      producerFile: { path: partPath, text: reversed },
    })
    expect(reordered.error).toBeNull()
    expect(reordered.names[1 - original.index]).toEqual(['left'])
    expect(readTargets(reorderedOffset)).toEqual([
      { body: reordered.body, edges: [reordered.expectedEdge] },
    ])

    const removed = savedProducer.replaceAll('16mm', '-5mm')
    await fs.writeFile(partPath, encoder.encode(removed))
    const removedOffset = readFileSync(auditLog!, 'utf8').length
    const missing = await replayFillet(page, {
      main,
      generated,
      mainPath,
      length: null,
      producerFile: { path: partPath, text: removed },
    })
    expect(missing.names).toEqual([['right']])
    expect(missing.error).toContain("No live Boolean output named 'left'")
    expect(readTargets(removedOffset)).toEqual([])
  }
)

test(
  'sketches on the clicked chamfer face on an imported pattern copy @localRenderer',
  { tag: ['@web', '@localRenderer'] },
  async ({ scene, page, homePage, toolbar, folderSetupFn, fs }) => {
    test.skip(
      !fixtureDirectory,
      'Requires the local copy-lineage engine and fixtures'
    )
    const main = readFileSync(
      resolve(fixtureDirectory!, 'lineage-copy-main.kcl'),
      'utf8'
    )
    const partName = 'lineage-copy-part.kcl'
    const part = readFileSync(resolve(fixtureDirectory!, partName), 'utf8')
    const projectName = 'chamfer-copy-lineage'
    const { dir } = await folderSetupFn(async (root) => {
      const project = await fs.join(root, projectName)
      await fs.mkdir(project, { recursive: true })
      const encoder = new TextEncoder()
      await fs.writeFile(
        await fs.join(project, 'main.kcl'),
        encoder.encode(main)
      )
      await fs.writeFile(await fs.join(project, partName), encoder.encode(part))
    })
    await homePage.openProject(projectName)
    await scene.settled()
    await scene.moveCameraTo({ x: 170, y: -30, z: 50 }, { x: 94, y: 46, z: 5 })

    const findPick = async () => {
      const projected = (await scene.getProjectedEntities()).filter(
        (entity) => entity.kind === 'bodyFace' && entity.visible
      )
      return page.evaluate(async (faces) => {
        const graph = window.app.singletons.kclManager.artifactGraph
        const pattern = [...graph.values()].find(
          (artifact) => artifact.type === 'pattern'
        )
        if (pattern?.type !== 'pattern') return null
        for (const face of faces) {
          const sourceId = pattern.copyFaceSources?.[face.id]
          const clone = sourceId ? graph.get(sourceId) : undefined
          if (
            clone?.type !== 'edgeCut' ||
            clone.subType !== 'chamfer' ||
            !clone.copySourceFaceId
          )
            continue
          const reply = await window.engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: crypto.randomUUID(),
            cmd: { type: 'query_entity_type', entity_id: face.id },
          })
          if (
            !reply ||
            Array.isArray(reply) ||
            !('resp' in reply) ||
            reply.resp.type !== 'modeling'
          )
            continue
          const payload = reply.resp.data.modeling_response
          if (payload.type !== 'query_entity_type') continue
          const reference = payload.data.reference
          if (
            reference.type === 'face' &&
            reference.topology_fallback?.parent_id === pattern.copyIds[0]
          ) {
            return face
          }
        }
        return null
      }, projected)
    }

    let pick: Awaited<ReturnType<typeof findPick>> = null
    await expect
      .poll(async () => {
        pick = await findPick()
        return pick !== null
      })
      .toBe(true)
    if (!pick)
      throw new Error('Missing a visible chamfer face on the middle instance')
    const { id, x, y } = pick as NonNullable<
      Awaited<ReturnType<typeof findPick>>
    >
    await page.mouse.click(x, y)
    await toolbar.expectSelection('1 face')
    await toolbar.startSketchBtn.click()
    await expect(toolbar.exitSketchBtn).toBeEnabled()
    const editor = page.locator('.cm-content[data-language="kcl"]')
    await expect(editor).toContainText('faceOf(instances[1], chamferFace = 0)')
    await expect(editor).not.toContainText('faceId(')
    expect(
      await page.evaluate(() => {
        const { getModelingState } = window as Window & {
          getModelingState?: () => {
            modelingState: {
              context: {
                sketchSolveId?: number
                initialSceneGraphDelta: SceneGraphDelta
              }
            }
          }
        }
        const context = getModelingState?.().modelingState.context
        if (context?.sketchSolveId === undefined) return null
        const { sketchSolveId, initialSceneGraphDelta } = context
        const objects = initialSceneGraphDelta.new_graph.objects
        const sketch = objects[sketchSolveId]
        return sketch?.kind.type === 'Sketch'
          ? objects[sketch.kind.plane]?.artifact_id
          : null
      })
    ).toBe(id)
    const savedPart = await fs.join(await fs.join(dir, projectName), partName)
    expect(new TextDecoder().decode(await fs.readFile(savedPart))).toBe(part)
  }
)

test(
  'fillets the clicked edge on an imported pattern copy @localRenderer',
  { tag: ['@web', '@localRenderer'] },
  async ({
    scene,
    page,
    homePage,
    toolbar,
    modelingDialog,
    folderSetupFn,
    fs,
  }) => {
    const auditLog = process.env.SELECT_ANYTHING_ENGINE_AUDIT_LOG
    test.skip(
      !fixtureDirectory || !auditLog,
      'Requires the local copy-lineage engine and fixtures'
    )
    const main = readFileSync(
      resolve(fixtureDirectory!, 'lineage-copy-main.kcl'),
      'utf8'
    )
    const partName = 'lineage-copy-part.kcl'
    const part = readFileSync(resolve(fixtureDirectory!, partName), 'utf8')
    const projectName = 'chamfer-copy-lineage'
    const { dir } = await folderSetupFn(async (root) => {
      const project = await fs.join(root, projectName)
      await fs.mkdir(project, { recursive: true })
      const encoder = new TextEncoder()
      await fs.writeFile(
        await fs.join(project, 'main.kcl'),
        encoder.encode(main)
      )
      await fs.writeFile(await fs.join(project, partName), encoder.encode(part))
    })
    await homePage.openProject(projectName)
    await scene.settled()
    await scene.moveCameraTo({ x: 170, y: -30, z: 50 }, { x: 94, y: 46, z: 5 })

    const findEdge = async () => {
      const projected = (await scene.getProjectedEntities()).filter(
        (entity) => entity.kind === 'edge' && entity.visible
      )
      return page.evaluate(async (edges) => {
        const { variables } = window.app.singletons.kclManager
        const instances = variables.instances
        if (instances?.type !== 'HomArray') return null
        const body = instances.value[1]
        if (body?.type !== 'Solid') return null
        for (const edge of edges) {
          const reply = await window.engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: crypto.randomUUID(),
            cmd: { type: 'query_entity_type', entity_id: edge.id },
          })
          if (
            !reply ||
            Array.isArray(reply) ||
            !('resp' in reply) ||
            reply.resp.type !== 'modeling'
          )
            continue
          const response = reply.resp.data.modeling_response
          if (response.type !== 'query_entity_type') continue
          const ref = response.data.reference
          if (
            ref.type !== 'edge' ||
            ref.topology_fallback?.parent_id !== body.value.id
          )
            continue
          if (
            !ref.side_faces.some((id) =>
              body.value.primaryChamferFaces?.includes(id)
            )
          )
            continue
          if (
            !ref.side_faces.some((id) =>
              body.value.historyFaceGroups?.some(
                ([face, , collection, name]) =>
                  face === id && collection === 'wallFaces' && name === 'side0'
              )
            )
          )
            continue
          const endpoints = await window.engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: crypto.randomUUID(),
            cmd: { type: 'curve_get_end_points', curve_id: edge.id },
          })
          if (
            !endpoints ||
            Array.isArray(endpoints) ||
            !('resp' in endpoints) ||
            endpoints.resp.type !== 'modeling'
          )
            continue
          const geometry = endpoints.resp.data.modeling_response
          if (geometry.type !== 'curve_get_end_points') continue
          const { start, end } = geometry.data
          return {
            ...edge,
            body: body.value.id,
            index: ref.topology_fallback.primitive_index,
            point: {
              x: (start.x + end.x) / 2,
              y: (start.y + end.y) / 2,
              z: (start.z + end.z) / 2,
            },
          }
        }
        return null
      }, projected)
    }
    let pick: Awaited<ReturnType<typeof findEdge>> = null
    await expect
      .poll(async () => {
        pick = await findEdge()
        return pick !== null
      })
      .toBe(true)
    const edge = pick as Awaited<ReturnType<typeof findEdge>>
    if (!edge)
      throw new Error('Missing a visible edge on the middle pattern copy')

    await page.mouse.click(edge.x, edge.y)
    await toolbar.expectSelection('1 edge')
    await toolbar.filletButton.click()
    await modelingDialog.fillInput('radius', '0.2')
    const offset = readFileSync(auditLog!, 'utf8').length
    await scene.waitForExecutionDoneAfter(() => modelingDialog.submit())
    const editor = page.locator('.cm-content[data-language="kcl"]')
    await expect(editor).toContainText('faceOf(instances[1], chamferFace = 0)')
    await expect(editor).toContainText(
      'instances[1].history.extrusions[0].wallFaces.side0'
    )
    await expect(editor).not.toContainText('edgeId(')
    const cutsSince = (offset: number) =>
      readFileSync(auditLog!, 'utf8')
        .slice(offset)
        .split('\n')
        .filter((line) => line.startsWith('SELECT_ANYTHING_CUT_TARGETS '))
        .map((line) =>
          JSON.parse(line.slice('SELECT_ANYTHING_CUT_TARGETS '.length))
        )
    expect(cutsSince(offset)).toEqual([{ body: edge.body, edges: [edge.id] }])
    await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
    const project = await fs.join(dir, projectName)
    const savedPart = await fs.join(project, partName)
    expect(new TextDecoder().decode(await fs.readFile(savedPart))).toBe(part)
    const generated = await page.evaluate(
      () => window.app.singletons.kclManager.code
    )
    const editedPart = part.replace(
      'copied = clone(beveled)',
      `extraChamfer = chamfer(beveled, edges = [{ sideFaces = [baseRegion.tags.side2, baseRegion.tags.side3] }], length = 1mm)
copied = clone(extraChamfer)`
    )
    expect(editedPart).not.toBe(part)
    await fs.writeFile(savedPart, new TextEncoder().encode(editedPart))
    const mainPath = await fs.join(project, 'main.kcl')
    const expected = await page.evaluate(
      async ({ main, part, partPath, mainPath, point }) => {
        const { rustContext, wasmInstancePromise } =
          window.app.singletons.kclManager
        const wasm = await wasmInstancePromise
        const parse = (code: string) => {
          const [ast, issues] = wasm.parse_wasm(code)
          if (!ast) throw new Error(JSON.stringify(issues))
          return ast
        }
        await rustContext.sendOpenProject(mainPath, [
          { id: 0, path: mainPath, text: main },
          { id: 1, path: partPath, text: part },
        ])
        await rustContext.clearSceneAndBustCache({}, mainPath)
        const before = await rustContext.execute(parse(main), {}, mainPath)
        const instances = before.variables.instances
        const body =
          instances?.type === 'HomArray' ? instances.value[1] : undefined
        if (body?.type !== 'Solid') throw new Error('Missing replay copy')
        if (body.value.primaryChamferFaces?.filter(Boolean).length !== 2) {
          throw new Error('The replay copy is missing the added chamfer')
        }
        const send = window.engineCommandManager.sendSceneCommand.bind(
          window.engineCommandManager
        )
        const reply = await send({
          type: 'modeling_cmd_req',
          cmd_id: crypto.randomUUID(),
          cmd: {
            type: 'closest_edge',
            object_id: body.value.id,
            closest_to: point,
          },
        })
        if (
          !reply ||
          Array.isArray(reply) ||
          !('resp' in reply) ||
          reply.resp.type !== 'modeling'
        )
          throw new Error('Missing replay edge')
        const hit = reply.resp.data.modeling_response
        if (hit.type !== 'closest_edge' || !hit.data.edge_id)
          throw new Error('Missing replay edge UUID')
        const topology = await send({
          type: 'modeling_cmd_req',
          cmd_id: crypto.randomUUID(),
          cmd: { type: 'query_entity_type', entity_id: hit.data.edge_id },
        })
        if (
          !topology ||
          Array.isArray(topology) ||
          !('resp' in topology) ||
          topology.resp.type !== 'modeling'
        )
          throw new Error('Missing replay edge topology')
        const response = topology.resp.data.modeling_response
        if (
          response.type !== 'query_entity_type' ||
          response.data.reference.type !== 'edge' ||
          response.data.reference.topology_fallback?.parent_id !== body.value.id
        )
          throw new Error('Unexpected replay edge owner')
        const endpoints = await send({
          type: 'modeling_cmd_req',
          cmd_id: crypto.randomUUID(),
          cmd: { type: 'curve_get_end_points', curve_id: hit.data.edge_id },
        })
        if (
          !endpoints ||
          Array.isArray(endpoints) ||
          !('resp' in endpoints) ||
          endpoints.resp.type !== 'modeling' ||
          endpoints.resp.data.modeling_response.type !== 'curve_get_end_points'
        ) {
          throw new Error('Missing replay edge endpoints')
        }
        const { start, end } = endpoints.resp.data.modeling_response.data
        if (
          Math.hypot(
            (start.x + end.x) / 2 - point.x,
            (start.y + end.y) / 2 - point.y,
            (start.z + end.z) / 2 - point.z
          ) > 1e-6
        ) {
          throw new Error('The nearest edge moved away from the original pick')
        }
        return {
          body: body.value.id,
          edge: hit.data.edge_id,
          index: response.data.reference.topology_fallback.primitive_index,
        }
      },
      {
        main,
        part: editedPart,
        partPath: savedPart,
        mainPath,
        point: edge.point,
      }
    )
    expect(expected.index).not.toBe(edge.index)
    console.info(
      `Copied edge index changed from ${edge.index} to ${expected.index}`
    )
    const replayOffset = readFileSync(auditLog!, 'utf8').length
    await page.evaluate(
      async ({ generated, mainPath }) => {
        const { rustContext, wasmInstancePromise } =
          window.app.singletons.kclManager
        const wasm = await wasmInstancePromise
        const [ast, issues] = wasm.parse_wasm(generated)
        if (!ast) throw new Error(JSON.stringify(issues))
        await rustContext.execute(ast, {}, mainPath)
      },
      { generated, mainPath }
    )
    expect(cutsSince(replayOffset)).toEqual([
      { body: expected.body, edges: [expected.edge] },
    ])
  }
)

for (const variant of [
  'joined',
  'joined anchor',
  'joined anchor off',
  'joined owned import',
  'joined renamed producer',
  'joined injection off',
  'joined read-only import',
  'joined fillet',
  'joined fillet anchor',
  'joined fillet inject',
  'joined fillet read-only',
  'support',
] as const) {
  test(
    `resolves indexed extrusion history on an imported ${variant} body @localRenderer`,
    { tag: ['@web', '@localRenderer'] },
    async ({
      scene,
      page,
      editor,
      homePage,
      toolbar,
      modelingDialog,
      folderSetupFn,
      fs,
    }) => {
      test.skip(
        !fixtureDirectory,
        'Requires the history fixtures and local engine'
      )
      const projectName =
        variant === 'support' ? 'history-support' : 'history-joined'
      const partName = `${projectName}-part.kcl`
      const main = readFileSync(
        resolve(fixtureDirectory!, `${projectName}-main.kcl`),
        'utf8'
      )
      const part = readFileSync(resolve(fixtureDirectory!, partName), 'utf8')
      const tagged =
        variant === 'joined anchor' ||
        variant === 'joined anchor off' ||
        variant === 'joined fillet anchor'
      const producer = tagged
        ? part.replace(
            /^(region003 = region\(.*)\)$/m,
            '$1, tag = $supportProfile)'
          )
        : variant === 'joined renamed producer'
          ? part.replaceAll('extrude003', 'renamedThirdExtrusion')
          : part

      const { dir } = await folderSetupFn(async (root) => {
        const project = await fs.join(root, projectName)
        await fs.mkdir(project, { recursive: true })
        const encoder = new TextEncoder()
        await fs.writeFile(
          await fs.join(project, 'main.kcl'),
          encoder.encode(main)
        )
        await fs.writeFile(
          await fs.join(project, partName),
          encoder.encode(producer)
        )
      })

      const engineAudit = process.env.SELECT_ANYTHING_ENGINE_AUDIT_LOG
      const testAuditOffset = engineAudit
        ? readFileSync(engineAudit, 'utf8').length
        : 0
      await homePage.openProject(projectName)
      await scene.settled()
      await expect
        .poll(() =>
          page.evaluate(() => {
            const { finished, resolvedWall } =
              window.app.singletons.kclManager.variables
            return (
              finished?.type === 'Solid' &&
              resolvedWall?.type === 'Face' &&
              resolvedWall.value.parentSolid.solidId === finished.value.id
            )
          })
        )
        .toBe(true)

      const caseProjectPath = await fs.join(dir, projectName)
      const casePartPath = await fs.join(caseProjectPath, partName)
      if (
        variant === 'joined read-only import' ||
        variant === 'joined fillet read-only'
      ) {
        await page.evaluate((path) => {
          const deps = window.app.singletons.kclManager.systemDeps
          const operations = deps.fileOperations
          deps.fileOperations = {
            ...operations,
            canReadWrite: (candidate: string) =>
              candidate === path
                ? Promise.resolve(false)
                : operations.canReadWrite(candidate),
          }
        }, casePartPath)
      }
      if (
        variant === 'joined fillet' ||
        variant === 'joined fillet anchor' ||
        variant === 'joined fillet inject' ||
        variant === 'joined fillet read-only'
      ) {
        if (variant === 'joined fillet' || variant === 'joined fillet anchor') {
          await page.getByRole('checkbox', { name: 'Inject anchors' }).uncheck()
        }
        const auditLog = process.env.SELECT_ANYTHING_ENGINE_AUDIT_LOG
        test.skip(!auditLog, 'Requires the engine edge audit')
        const findEdge = async () =>
          page.evaluate(
            async ({ edges, sameExtrusion }) => {
              const body = window.app.singletons.kclManager.variables.finished
              if (body?.type !== 'Solid') throw new Error('Missing joined body')
              const groups = body.value.historyFaceGroups ?? []
              for (const edge of edges) {
                const reply =
                  await window.engineCommandManager.sendSceneCommand({
                    type: 'modeling_cmd_req',
                    cmd_id: crypto.randomUUID(),
                    cmd: { type: 'query_entity_type', entity_id: edge.id },
                  })
                if (
                  !reply ||
                  Array.isArray(reply) ||
                  !('resp' in reply) ||
                  reply.resp.type !== 'modeling'
                )
                  continue
                const response = reply.resp.data.modeling_response
                if (response.type !== 'query_entity_type') continue
                const ref = response.data.reference
                if (
                  ref.type !== 'edge' ||
                  ref.index != null ||
                  ref.topology_fallback?.parent_id !== body.value.id ||
                  ref.side_faces.length !== 2 ||
                  ref.end_faces?.length
                )
                  continue
                const sides = ref.side_faces.map((id) =>
                  groups.find(([face]) => id === face)
                )
                if (!sides.some((side) => side?.[1] === 2)) continue
                if (
                  sameExtrusion &&
                  (!sides.every((side) => side?.[1] === 2) ||
                    !sides.some(
                      (side) => side?.[2] === 'capFaces' && side[3] === 'end'
                    ) ||
                    !sides.some((side) => side?.[2] === 'wallFaces'))
                )
                  continue
                if (
                  !sides.every(
                    (side) =>
                      side &&
                      groups.filter(
                        ([, extrusion, collection, member]) =>
                          extrusion === side[1] &&
                          collection === side[2] &&
                          member === side[3]
                      ).length === 1
                  )
                )
                  continue
                return { ...edge, body: body.value.id }
              }
              return null
            },
            {
              edges: (await scene.getProjectedEntities()).filter(
                (entity) => entity.kind === 'edge' && entity.visible
              ),
              sameExtrusion: variant === 'joined fillet inject',
            }
          )
        let projected: Awaited<ReturnType<typeof findEdge>> = null
        await expect
          .poll(async () => {
            projected = await findEdge()
            return projected?.id
          })
          .toBeTruthy()
        const pick = projected as Awaited<ReturnType<typeof findEdge>>
        if (!pick)
          throw new Error('No unambiguous named edge on the joined extrusion')
        await page.mouse.click(pick.x, pick.y)
        await toolbar.expectSelection('1 edge')
        await toolbar.filletButton.click()
        await modelingDialog.fillInput('radius', '0.2')
        const textBefore = readFileSync(auditLog!, 'utf8')
        const offset = textBefore.length
        await scene.waitForExecutionDoneAfter(() => modelingDialog.submit())
        await editor.expectEditor.toContain(
          variant === 'joined fillet anchor'
            ? 'finished.anchors.supportProfile'
            : variant === 'joined fillet inject'
              ? 'finished.anchors.regionAnchor001'
              : 'finished.history.extrusions[2]'
        )
        const targets = readFileSync(auditLog!, 'utf8')
          .slice(offset)
          .split('\n')
          .filter((line) => line.startsWith('SELECT_ANYTHING_CUT_TARGETS '))
          .filter(
            (line) =>
              variant !== 'joined fillet inject' ||
              !textBefore.slice(testAuditOffset).includes(line)
          )
          .map((line) =>
            JSON.parse(line.slice('SELECT_ANYTHING_CUT_TARGETS '.length))
          )
        expect(targets).toEqual([{ body: pick.body, edges: [pick.id] }])
        if (variant === 'joined fillet inject') {
          const root = await fs.join(dir, projectName)
          const savedPart = await fs.join(root, partName)
          const savedMain = await fs.join(root, 'main.kcl')
          const read = async (path: string) =>
            new TextDecoder().decode(await fs.readFile(path))
          const taggedProducer = producer.replace(
            /^(region003 = region\(.*)\)$/m,
            '$1, tag = $regionAnchor001)'
          )
          expect(await read(savedPart)).toBe(taggedProducer)
          expect(await read(savedMain)).toContain(
            'finished.anchors.regionAnchor001.wallFaces.'
          )
          expect(await read(savedMain)).toContain(
            'finished.anchors.regionAnchor001.capFaces.'
          )
          await page.evaluate(() => window.app.singletons.kclManager.undo())
          await expect.poll(() => read(savedPart)).toBe(producer)
          await expect.poll(() => read(savedMain)).toBe(main)
        } else {
          expect(
            new TextDecoder().decode(await fs.readFile(casePartPath))
          ).toBe(producer)
        }
      }

      if (
        variant === 'joined' ||
        variant === 'joined anchor' ||
        variant === 'joined anchor off' ||
        variant === 'joined owned import' ||
        variant === 'joined renamed producer' ||
        variant === 'joined injection off' ||
        variant === 'joined read-only import'
      ) {
        if (
          variant === 'joined anchor off' ||
          variant === 'joined injection off' ||
          variant === 'joined renamed producer' ||
          variant === 'joined'
        ) {
          await page.getByRole('checkbox', { name: 'Inject anchors' }).uncheck()
        }
        const projectPath = await fs.join(dir, projectName)
        const savedPart = await fs.join(projectPath, partName)
        const wallId = await page.evaluate(() => {
          const wall = window.app.singletons.kclManager.variables.resolvedWall
          return wall?.type === 'Face' ? wall.value.id : null
        })
        if (!wallId) throw new Error('Missing the joined wall face')

        const findPick = async () =>
          (await scene.getProjectedEntities()).find(
            (entity) =>
              entity.kind === 'bodyFace' &&
              entity.visible &&
              entity.id === wallId
          )
        const plane = await page.evaluate(async (id) => {
          const reply = await window.engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: crypto.randomUUID(),
            cmd: { type: 'face_is_planar', object_id: id },
          })
          if (
            !reply ||
            Array.isArray(reply) ||
            !('resp' in reply) ||
            reply.resp.type !== 'modeling'
          )
            return null
          const response = reply.resp.data.modeling_response
          return response.type === 'face_is_planar' ? response.data : null
        }, wallId)
        if (!plane?.origin || !plane.z_axis) {
          throw new Error('Missing the joined wall plane')
        }
        const { origin, z_axis: normal } = plane
        await scene.moveCameraTo(
          {
            x: origin.x + 100 * normal.x,
            y: origin.y + 100 * normal.y,
            z: origin.z + 100 * normal.z,
          },
          origin
        )
        let projectedPick: Awaited<ReturnType<typeof findPick>>
        await expect
          .poll(async () => {
            projectedPick = await findPick()
            return projectedPick?.id
          })
          .toBe(wallId)
        const pick = projectedPick!
        if (!pick) throw new Error('The joined wall is not visible')
        await page.mouse.click(pick.x, pick.y)
        await toolbar.expectSelection('1 face')
        await toolbar.startSketchBtn.click()
        await expect(toolbar.exitSketchBtn).toBeEnabled()
        await expect(
          page.locator('.cm-content[data-language="kcl"]')
        ).toContainText(
          variant === 'joined owned import'
            ? 'sketch(on = finished.anchors.regionAnchor001.walls.line3)'
            : tagged
              ? 'sketch(on = finished.anchors.supportProfile.walls.line3)'
              : 'sketch(on = finished.history.extrusions[2].walls.line3)'
        )
        const supportId = await page.evaluate(() => {
          const { getModelingState } = window as Window & {
            getModelingState?: () => {
              modelingState: {
                context: {
                  sketchSolveId?: number
                  initialSceneGraphDelta: SceneGraphDelta
                }
              }
            }
          }
          const context = getModelingState?.().modelingState.context
          if (context?.sketchSolveId === undefined) return null
          const { sketchSolveId, initialSceneGraphDelta } = context
          const objects = initialSceneGraphDelta.new_graph.objects
          const sketch = objects[sketchSolveId]
          return sketch?.kind.type === 'Sketch'
            ? objects[sketch.kind.plane]?.artifact_id
            : null
        })
        expect(supportId).toBe(pick.id)
        if (variant === 'joined owned import') {
          const savedMain = await fs.join(projectPath, 'main.kcl')
          const read = async (path: string) =>
            new TextDecoder().decode(await fs.readFile(path))
          const taggedProducer = producer.replace(
            /^(region003 = region\(.*)\)$/m,
            '$1, tag = $regionAnchor001)'
          )
          await expect.poll(() => read(savedPart)).toBe(taggedProducer)
          await expect
            .poll(() => read(savedMain))
            .toContain(
              'sketch(on = finished.anchors.regionAnchor001.walls.line3)'
            )
          await page.evaluate(() => window.app.singletons.kclManager.undo())
          await expect.poll(() => read(savedPart)).toBe(producer)
          await expect.poll(() => read(savedMain)).toBe(main)
          await editor.expectEditor.not.toContain('sketch001 =')
        } else {
          expect(new TextDecoder().decode(await fs.readFile(savedPart))).toBe(
            producer
          )
        }
      }

      if (variant === 'support') {
        await editor.replaceCode('extrusions[0]', 'extrusions[2]')
        await expect
          .poll(() =>
            page.evaluate(() =>
              window.app.singletons.kclManager.errors.map(
                (error) => error.message
              )
            )
          )
          .toContain('semantic: No contributing extrusion at index 2.')
        await editor.replaceCode('extrusions[2]', 'extrusions.extrude001')
        await expect
          .poll(() =>
            page.evaluate(() =>
              window.app.singletons.kclManager.errors.map(
                (error) => error.message
              )
            )
          )
          .toContain(
            'semantic: Use a zero-based index for history.extrusions, or an explicit region anchor.'
          )
      }
    }
  )
}

test(
  'renders the shell outer wall, offset wall and rim @localRenderer',
  { tag: ['@web', '@localRenderer'] },
  async ({ scene, page, editor, homePage }) => {
    test.skip(!fixtureDirectory, 'Requires the local shell fixture')
    const code = readFileSync(
      resolve(fixtureDirectory!, 'shell-lineage.kcl'),
      'utf8'
    )
    await homePage.goToModelingScene()
    await scene.settled()
    await scene.waitForExecutionDoneAfter(() => editor.replaceCode('', code))
    await scene.moveCameraTo({ x: 55, y: -48, z: 60 }, { x: 15, y: 12, z: 8 })
    await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
    await expect
      .poll(async () => {
        const faces = (await scene.getProjectedEntities())
          .filter((entity) => entity.kind === 'bodyFace')
          .map((entity) => entity.id)
        return page.evaluate(async (ids) => {
          const planes = await Promise.all(
            ids.map(async (id) => {
              const reply = await window.engineCommandManager.sendSceneCommand({
                type: 'modeling_cmd_req',
                cmd_id: crypto.randomUUID(),
                cmd: { type: 'face_is_planar', object_id: id },
              })
              if (
                !reply ||
                Array.isArray(reply) ||
                !('resp' in reply) ||
                reply.resp.type !== 'modeling'
              )
                return
              const response = reply.resp.data.modeling_response
              if (response.type !== 'face_is_planar') return
              const { origin, z_axis: normal } = response.data
              if (origin && normal) return { origin, normal }
            })
          )
          const near = (a: number, b: number) => Math.abs(a - b) < 0.001
          return {
            outer: planes.some(
              (p) => p && near(p.origin.y, 0) && near(Math.abs(p.normal.y), 1)
            ),
            offset: planes.some(
              (p) => p && near(p.origin.y, 2) && near(Math.abs(p.normal.y), 1)
            ),
            rim: planes.some(
              (p) => p && near(p.origin.z, 16) && near(Math.abs(p.normal.z), 1)
            ),
          }
        }, faces)
      })
      .toEqual({ outer: true, offset: true, rim: true })
  }
)
