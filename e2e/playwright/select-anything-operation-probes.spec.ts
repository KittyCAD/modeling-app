import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@e2e/playwright/zoo-test'

const fixtureDirectory = process.env.SELECT_ANYTHING_FIXTURE_DIR

for (const { fixture, names } of [
  { fixture: 'shell-lineage', names: ['tray'] },
  { fixture: 'sweep-lineage', names: ['swept'] },
  { fixture: 'loft-lineage', names: ['lofted', 'reflected'] },
]) {
  test(
    `inspects live topology for ${fixture} @localRenderer`,
    { tag: ['@web', '@localRenderer'] },
    async ({ editor, homePage, page, scene }) => {
      test.skip(!fixtureDirectory, 'Requires the local geometry fixtures')
      const code = readFileSync(
        resolve(fixtureDirectory!, fixture + '.kcl'),
        'utf8'
      )
      await homePage.goToModelingScene()
      await scene.settled()
      await scene.waitForExecutionDoneAfter(() => editor.replaceCode('', code))
      const inspect = () =>
        page.evaluate(async (names) => {
          const manager = window.app.singletons.kclManager
          const graph = manager.artifactGraph
          const results = []
          for (const name of names) {
            const value = manager.variables[name]
            const body = value?.type === 'HomArray' ? value.value[0] : value
            if (body?.type !== 'Solid') throw new Error(`Missing solid ${name}`)
            const id = body.value.id
            const children = await window.engineCommandManager.sendSceneCommand(
              {
                type: 'modeling_cmd_req',
                cmd_id: crypto.randomUUID(),
                cmd: { type: 'entity_get_all_child_uuids', entity_id: id },
              }
            )
            if (
              !children ||
              Array.isArray(children) ||
              !('resp' in children) ||
              children.resp.type !== 'modeling' ||
              children.resp.data.modeling_response.type !==
                'entity_get_all_child_uuids'
            ) {
              throw new Error(`Missing child identities for ${name}`)
            }
            const live = new Set(
              children.resp.data.modeling_response.data.entity_ids
            )
            const faceIds = []
            for (const id of live) {
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
              if (
                response.type === 'query_entity_type' &&
                response.data.reference.type === 'face'
              )
                faceIds.push(id)
            }
            const planes = []
            for (const id of faceIds) {
              const response =
                await window.engineCommandManager.sendSceneCommand({
                  type: 'modeling_cmd_req',
                  cmd_id: crypto.randomUUID(),
                  cmd: { type: 'face_is_planar', object_id: id },
                })
              if (
                !response ||
                Array.isArray(response) ||
                !('resp' in response) ||
                response.resp.type !== 'modeling'
              )
                continue
              const result = response.resp.data.modeling_response
              if (
                result.type === 'face_is_planar' &&
                result.data.origin &&
                result.data.z_axis
              ) {
                planes.push({
                  id,
                  origin: result.data.origin,
                  normal: result.data.z_axis,
                })
              }
            }
            results.push({
              id,
              name,
              faceIds,
              planes,
              history: body.value.historyFaceGroups ?? [],
              artifacts: faceIds.map((id) => graph.get(id)?.type ?? null),
              liveHistory: (body.value.historyFaceGroups ?? []).filter(([id]) =>
                live.has(id)
              ),
            })
          }
          return results
        }, names)
      let result: Awaited<ReturnType<typeof inspect>> = []
      await expect
        .poll(async () => {
          result = await inspect()
          return (
            result.length === names.length &&
            result.every((body) => body.faceIds.length > 0)
          )
        })
        .toBe(true)
      expect(result).toHaveLength(names.length)
      for (const body of result) {
        expect(body.faceIds.length).toBeGreaterThan(0)
        expect(new Set(body.faceIds).size).toBe(body.faceIds.length)
      }
      if (fixture === 'shell-lineage') {
        const role = (body: (typeof result)[number], offset: number) => {
          const near = (a: number, b: number) => Math.abs(a - b) < 0.001
          return [
            body.planes.find(
              (p) => near(p.origin.y, 0) && near(Math.abs(p.normal.y), 1)
            ),
            body.planes.find(
              (p) => near(p.origin.y, offset) && near(Math.abs(p.normal.y), 1)
            ),
            body.planes.find(
              (p) => near(p.origin.z, 16) && near(Math.abs(p.normal.z), 1)
            ),
          ]
        }
        const before = role(result[0], 2)
        expect(before.every(Boolean)).toBe(true)
        await scene.waitForExecutionDoneAfter(() =>
          editor.replaceCode('thickness = 2mm', 'thickness = 3mm')
        )
        let after: Awaited<ReturnType<typeof inspect>> = []
        await expect
          .poll(async () => {
            after = await inspect()
            return role(after[0], 3).every(Boolean)
          })
          .toBe(true)
        const replay = role(after[0], 3)
        expect(replay.map((plane) => plane?.id)).toEqual(
          before.map((plane) => plane?.id)
        )
        expect(result[0].liveHistory).toContainEqual([
          before[2]?.id,
          0,
          'capFaces',
          'end',
        ])
        expect(result[0].liveHistory.some(([id]) => id === before[1]?.id)).toBe(
          false
        )
      } else if (fixture === 'sweep-lineage') {
        const resolved = await page.evaluate(() => {
          const { sweptFront } = window.app.singletons.kclManager.variables
          return sweptFront?.type === 'Face'
            ? {
                id: sweptFront.value.id,
                owner: sweptFront.value.parentSolid.solidId,
              }
            : null
        })
        expect(resolved).toEqual({
          id: result[0].liveHistory.find(
            ([, , collection, name]) =>
              collection === 'wallFaces' && name === 'front'
          )?.[0],
          owner: result[0].id,
        })
      }
      if (result.length === 2) {
        expect(result[0].id).not.toBe(result[1].id)
        const selectorTypes = await page.evaluate(() => {
          const { loftWall, reflectedWall } =
            window.app.singletons.kclManager.variables
          return [loftWall?.type, reflectedWall?.type]
        })
        expect(selectorTypes).toEqual(['Object', 'Object'])
        for (const body of result) {
          const wall = body.liveHistory.find(
            ([, , kind, name]) => kind === 'wallFaces' && name === 'rim'
          )
          expect(wall?.[1]).toBe(0)
          expect(body.faceIds).toContain(wall?.[0])
        }

        expect(
          result[0].faceIds.filter((id) => result[1].faceIds.includes(id))
        ).toEqual([])
      }
      console.info('operation topology', JSON.stringify(result))
    }
  )
}

test(
  'registers each engine-reported chamfer face on the live body @localRenderer',
  { tag: ['@web', '@localRenderer'] },
  async ({ editor, homePage, page, scene }) => {
    test.skip(!fixtureDirectory, 'Requires the local geometry fixtures')
    const code = readFileSync(
      resolve(fixtureDirectory!, 'chamfer-feedback.kcl'),
      'utf8'
    )
    type CutResponse = {
      type?: string
      data?: { created_face_ids?: string[] }
    }
    const reportedFaces: string[][] = []
    page.on('websocket', (socket) => {
      if (!new URL(socket.url()).searchParams.has('geometry_only')) return
      socket.on('framereceived', ({ payload }) => {
        if (typeof payload !== 'string') return
        const reply = JSON.parse(payload) as {
          resp?: {
            data?: {
              modeling_response?: CutResponse
              responses?: Record<string, { response?: CutResponse }>
            }
          }
        }
        const cuts = [
          reply.resp?.data?.modeling_response,
          ...Object.values(reply.resp?.data?.responses ?? {}).map(
            (entry) => entry.response
          ),
        ]
        for (const cut of cuts) {
          if (
            cut?.type === 'solid3d_cut_edge_references' &&
            cut.data?.created_face_ids
          ) {
            reportedFaces.push(cut.data.created_face_ids)
          }
        }
      })
    })
    await homePage.goToModelingScene()
    await scene.settled()
    await scene.waitForExecutionDoneAfter(() => editor.replaceCode('', code))

    const inspect = () =>
      page.evaluate(async () => {
        const manager = window.app.singletons.kclManager
        const beveled = manager.variables.beveled
        if (beveled?.type !== 'Solid') throw new Error('Missing chamfer result')
        const bodyId = beveled.value.id
        const response = await window.engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: crypto.randomUUID(),
          cmd: { type: 'entity_get_all_child_uuids', entity_id: bodyId },
        })
        if (
          !response ||
          Array.isArray(response) ||
          !('resp' in response) ||
          response.resp.type !== 'modeling' ||
          response.resp.data.modeling_response.type !==
            'entity_get_all_child_uuids'
        ) {
          throw new Error('Missing live chamfer body children')
        }
        const artifacts = [...manager.artifactGraph.values()].filter(
          (artifact) => artifact.type === 'edgeCut'
        )
        const live = new Set(
          response.resp.data.modeling_response.data.entity_ids
        )
        return artifacts
          .map((artifact) => ({
            id: artifact.id,
            live: live.has(artifact.id),
            sourceSelectorIndex: artifact.sourceSelectorIndex,
            subType: artifact.subType,
          }))
          .sort(
            (a, b) =>
              (a.sourceSelectorIndex ?? -1) - (b.sourceSelectorIndex ?? -1)
          )
      })

    const expectFaces = async (indices: number[]) => {
      await expect
        .poll(async () => {
          const artifacts = await inspect()
          return {
            matchesReport:
              reportedFaces.at(-1)?.slice().sort().join() ===
              artifacts
                .map(({ id }) => id)
                .sort()
                .join(),
            artifacts: artifacts.map(({ id: _id, ...artifact }) => artifact),
          }
        })
        .toEqual({
          matchesReport: true,
          artifacts: indices.map((sourceSelectorIndex) => ({
            live: true,
            sourceSelectorIndex,
            subType: 'chamfer',
          })),
        })
    }
    await expectFaces([0, 1])

    await scene.waitForExecutionDoneAfter(() =>
      editor.replaceCode(
        ',\n    { sideFaces = [baseRegion.tags.side2, baseRegion.tags.side3] }',
        ''
      )
    )
    await expectFaces([0])

    await scene.waitForExecutionDoneAfter(() =>
      editor.replaceCode('tangentChain = false', 'tangentChain = true')
    )
    await expectFaces([0])
  }
)

test(
  'replays a sketch on the bevel reached by tangent chaining @localRenderer',
  { tag: ['@web', '@localRenderer'] },
  async ({ editor, homePage, page, scene, toolbar }) => {
    test.skip(!fixtureDirectory, 'Requires the local geometry fixtures')
    const code = readFileSync(
      resolve(fixtureDirectory!, 'chamfer-generated-face.kcl'),
      'utf8'
    )
    await homePage.goToModelingScene()
    await scene.settled()
    await scene.waitForExecutionDoneAfter(() => editor.replaceCode('', code))

    // Identify the target independently of the source attribution under test.
    // Its outward normal points toward +Y and +Z.
    const inspect = () =>
      page.evaluate(async () => {
        const manager = window.app.singletons.kclManager
        const beveled = manager.variables.beveled
        if (beveled?.type !== 'Solid') return null
        const engine = window.engineCommandManager
        const query = async (
          cmd: Extract<
            Parameters<typeof engine.sendSceneCommand>[0],
            { type: 'modeling_cmd_req' }
          >['cmd']
        ) => {
          const response = await engine.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: crypto.randomUUID(),
            cmd,
          })
          if (
            !response ||
            Array.isArray(response) ||
            !('resp' in response) ||
            response.resp.type !== 'modeling'
          ) {
            return null
          }
          return response.resp.data.modeling_response
        }
        const children = await query({
          type: 'entity_get_all_child_uuids',
          entity_id: beveled.value.id,
        })
        if (children?.type !== 'entity_get_all_child_uuids') return null
        for (const id of children.data.entity_ids) {
          const info = await query({ type: 'query_entity_type', entity_id: id })
          if (
            info?.type !== 'query_entity_type' ||
            info.data.reference.type !== 'face'
          )
            continue
          const response = await query({
            type: 'face_is_planar',
            object_id: id,
          })
          if (response?.type !== 'face_is_planar') continue
          const { origin, z_axis: normal } = response.data
          if (!origin || !normal || normal.y < 0.5 || normal.z < 0.5) continue
          const artifact = manager.artifactGraph.get(id)
          return {
            id,
            primitive: info.data.reference.topology_fallback?.primitive_index,
            origin,
            normal,
            roles:
              artifact?.type === 'edgeCut'
                ? artifact.generatedFrom?.sideFaces
                    .map(
                      (side) =>
                        beveled.value.historyFaceGroups?.find(
                          (group) => group[0] === side
                        )?.[3]
                    )
                    .sort()
                : undefined,
          }
        }
        return null
      })
    await expect
      .poll(async () => (await inspect())?.roles)
      .toEqual(['topCap', 'upper'])
    const before = (await inspect())!
    expect(before.primitive).toBeDefined()
    await scene.moveCameraTo(
      {
        x: before.origin.x + 48 * before.normal.x,
        y: before.origin.y + 48 * before.normal.y,
        z: before.origin.z + 48 * before.normal.z,
      },
      before.origin
    )
    const findPick = async () =>
      (await scene.getProjectedEntities()).find(
        (entity) =>
          entity.kind === 'bodyFace' &&
          entity.visible &&
          entity.id === before.id
      )
    let projectedPick: Awaited<ReturnType<typeof findPick>>
    await expect
      .poll(async () => {
        projectedPick = await findPick()
        return projectedPick?.id
      })
      .toBe(before.id)
    const pick = projectedPick!
    await page.mouse.click(pick.x, pick.y)
    await toolbar.expectSelection('1 face')
    await toolbar.startSketchBtn.click()
    await expect(toolbar.exitSketchBtn).toBeEnabled()
    await editor.expectEditor.toContain('fromFaces')
    await editor.expectEditor.not.toContain('faceId(')
    const inspectSketch = () =>
      page.evaluate(() => {
        const manager = window.app.singletons.kclManager
        const sketch = [...manager.artifactGraph.values()].find(
          (artifact) =>
            artifact.type === 'sketchBlock' && !artifact.standardPlane
        )
        return {
          code: manager.editorView.state.doc.toString(),
          face: sketch?.type === 'sketchBlock' ? sketch.planeId : null,
        }
      })
    await expect.poll(async () => (await inspectSketch()).face).toBe(before.id)
    const selected = await inspectSketch()
    expect(selected.code).toContain('.wallFaces.upper')
    expect(selected.code).toContain('.capFaces.end')
    expect(selected.face).toBe(before.id)

    await toolbar.exitSketchBtn.click()
    // Keep the exact generated support and make the sketch nonempty.
    const save = selected.code.replace(
      /\)\s*\{\s*\}\s*$/,
      ') {\n  mark = line(start = [0mm, 0mm], end = [1mm, 0mm])\n}\n'
    )
    expect(save).toContain('mark = line')
    const replay = save.replace(
      'end = [30mm, 0mm])\n  right = line(start = [30mm, 0mm]',
      'end = [28mm, 0mm])\n  corner = line(start = [28mm, 0mm], end = [30mm, 2mm])\n  right = line(start = [30mm, 2mm]'
    )
    expect(replay).not.toBe(save)
    await editor.replaceCode('', replay)
    await page.evaluate(() =>
      window.app.singletons.kclManager.flushPendingEditorExecution()
    )
    await expect
      .poll(() =>
        page.evaluate(() => {
          const solid = window.app.singletons.kclManager.variables.beveled
          return (
            solid?.type === 'Solid' &&
            solid.value.historyFaceGroups?.some(
              (group) => group[3] === 'corner'
            )
          )
        })
      )
      .toBe(true)
    await expect
      .poll(async () => {
        const after = await inspect()
        return after?.primitive != null && after.primitive !== before.primitive
      })
      .toBe(true)
    const after = (await inspect())!
    expect(after.primitive).toBeDefined()
    console.log(
      `Bevel face index changed from ${before.primitive} to ${after.primitive}`
    )
    expect(after.primitive).not.toBe(before.primitive)
    expect((await inspectSketch()).face).toBe(after.id)

    // Appending a second use exercises the already-evaluated chamfer and sketch.
    // The sketch plane can occupy the bevel's ID in the artifact graph.
    const expression = replay.match(/^face001 = ([\s\S]*?)^sketch001 =/m)?.[1]
    expect(expression).toBeDefined()
    await editor.replaceCode('', replay + '\nface002 = ' + expression)
    await page.evaluate(() =>
      window.app.singletons.kclManager.flushPendingEditorExecution()
    )
    await expect
      .poll(() =>
        page.evaluate(() => {
          const face = window.app.singletons.kclManager.variables.face002
          return face?.type === 'Face' ? face.value.id : null
        })
      )
      .toBe(after.id)

    await editor.replaceCodeByTyping(
      'tangentChain = true',
      'tangentChain = false'
    )
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.app.singletons.kclManager.errors.map((error) => error.message)
        )
      )
      .toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            'This chamfer no longer reports a face from the selected source edge.'
          ),
        ])
      )
  }
)
