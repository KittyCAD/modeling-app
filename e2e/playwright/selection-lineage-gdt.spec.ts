import type { EdgeSpecifier } from '@kittycad/lib'
import { decode } from '@msgpack/msgpack'
import type { EngineCommand } from '@src/lang/std/artifactGraph'
import { expect, test } from '@e2e/playwright/zoo-test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const fixtureDirectory = process.env.SELECT_ANYTHING_FIXTURE_DIR

for (const fixture of [
  'joined wall',
  'split edge',
  'copied chamfer',
] as const) {
  test(
    `probes GD&T attachment to a ${fixture}`,
    { tag: ['@web', '@localRenderer'] },
    async ({
      page,
      scene,
      toolbar,
      homePage,
      folderSetupFn,
      fs,
      cmdBar,
      modelingDialog,
      editor,
    }) => {
      test.skip(
        !fixtureDirectory,
        'Requires Select Anything fixtures and local engine'
      )
      const prefix =
        fixture === 'joined wall'
          ? 'history-joined'
          : fixture === 'copied chamfer'
            ? 'lineage-copy'
            : 'edge-split'
      const main = readFileSync(
        resolve(
          fixtureDirectory!,
          fixture === 'split edge' ? `${prefix}.kcl` : `${prefix}-main.kcl`
        ),
        'utf8'
      )
      const partName = `${prefix}-part.kcl`
      const projectName = `gdt-${prefix}`
      await folderSetupFn(async (root) => {
        const project = await fs.join(root, projectName)
        await fs.mkdir(project, { recursive: true })
        const encoder = new TextEncoder()
        await fs.writeFile(
          await fs.join(project, 'main.kcl'),
          encoder.encode(main)
        )
        if (fixture !== 'split edge') {
          const part = readFileSync(
            resolve(fixtureDirectory!, partName),
            'utf8'
          )
          await fs.writeFile(
            await fs.join(project, partName),
            encoder.encode(part)
          )
        }
      })
      const annotationEdges: EdgeSpecifier[] = []
      if (fixture === 'split edge') {
        page.on('websocket', (socket) => {
          if (!new URL(socket.url()).searchParams.has('geometry_only')) return
          socket.on('framesent', ({ payload }) => {
            const command = (
              typeof payload === 'string'
                ? JSON.parse(payload)
                : decode(payload)
            ) as EngineCommand
            const requests =
              command.type === 'modeling_cmd_batch_req'
                ? command.requests
                : command.type === 'modeling_cmd_req'
                  ? [command]
                  : []
            for (const { cmd } of requests) {
              if (cmd.type !== 'new_annotation') continue
              const options = cmd.options.feature_control
              if (
                options &&
                'edge_reference' in options &&
                options.edge_reference
              )
                annotationEdges.push(options.edge_reference)
            }
          })
        })
      }
      await homePage.openProject(projectName)
      await scene.settled()
      if (fixture === 'joined wall') {
        const plane = await page.evaluate(async () => {
          const wall = window.app.singletons.kclManager.variables.resolvedWall
          if (wall?.type !== 'Face') throw new Error('Missing history wall')
          const response = await window.engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: crypto.randomUUID(),
            cmd: { type: 'face_is_planar', object_id: wall.value.id },
          })
          if (
            Array.isArray(response) ||
            !response ||
            !('resp' in response) ||
            response.resp.type !== 'modeling'
          )
            throw new Error('Missing plane response')
          const result = response.resp.data.modeling_response
          if (
            result.type !== 'face_is_planar' ||
            !result.data.origin ||
            !result.data.z_axis
          )
            throw new Error('Missing wall plane')
          return { origin: result.data.origin, normal: result.data.z_axis }
        })
        const { origin, normal } = plane
        await scene.moveCameraTo(
          {
            x: origin.x + 100 * normal.x,
            y: origin.y + 100 * normal.y,
            z: origin.z + 100 * normal.z,
          },
          origin
        )
      } else if (fixture === 'split edge') {
        await scene.moveCameraTo(
          { x: 65, y: -65, z: -45 },
          { x: 20, y: 15, z: 5 }
        )
      } else {
        await scene.moveCameraTo(
          { x: 170, y: -30, z: 50 },
          { x: 94, y: 46, z: 5 }
        )
      }

      const findPick = async () => {
        const projected = (await scene.getProjectedEntities()).filter(
          (entity) =>
            entity.visible &&
            entity.kind === (fixture === 'split edge' ? 'edge' : 'face')
        )
        return page.evaluate(
          async ({ fixture, projected }) => {
            const { artifactGraph: graph, variables } =
              window.app.singletons.kclManager
            if (fixture === 'joined wall') {
              const wall = variables.resolvedWall
              return wall?.type === 'Face'
                ? projected.find(({ id }) => id === wall.value.id)
                : undefined
            }
            const pattern = [...graph.values()].find(
              (artifact) => artifact.type === 'pattern'
            )
            const fragments = new Map<string, typeof projected>()
            for (const entity of projected) {
              if (fixture === 'copied chamfer') {
                const sourceId = pattern?.copyFaceSources?.[entity.id]
                const source = sourceId ? graph.get(sourceId) : undefined
                if (
                  source?.type !== 'edgeCut' ||
                  source.subType !== 'chamfer' ||
                  !source.copySourceFaceId
                )
                  continue
              }
              const response =
                await window.engineCommandManager.sendSceneCommand({
                  type: 'modeling_cmd_req',
                  cmd_id: crypto.randomUUID(),
                  cmd: { type: 'query_entity_type', entity_id: entity.id },
                })
              if (
                Array.isArray(response) ||
                !response ||
                !('resp' in response) ||
                response.resp.type !== 'modeling'
              )
                continue
              const result = response.resp.data.modeling_response
              if (result.type !== 'query_entity_type') continue
              const ref = result.data.reference
              if (fixture === 'copied chamfer') {
                if (
                  ref.type === 'face' &&
                  ref.topology_fallback?.parent_id === pattern?.copyIds[0]
                )
                  return entity
                continue
              }
              if (ref.type !== 'edge' || !ref.topology_fallback?.parent_id)
                continue
              const owner = graph.get(ref.topology_fallback.parent_id)
              if (owner?.type !== 'compositeSolid' || owner.outputIndex !== 0)
                continue
              const sourceFaces = ref.side_faces.map(
                (id) => owner.subtractionFaceSources?.[id] ?? id
              )
              if (
                !sourceFaces.some((id) => {
                  const face = graph.get(id)
                  return face?.type === 'cap' && face.subType === 'start'
                })
              )
                continue
              const key = sourceFaces.sort().join(',')
              const siblings = fragments.get(key) ?? []
              siblings.push(entity)
              fragments.set(key, siblings)
            }
            return [...fragments.values()]
              .find((group) => group.length === 2)
              ?.sort((a, b) => a.x - b.x)[0]
          },
          { fixture, projected }
        )
      }
      let pick: Awaited<ReturnType<typeof findPick>>
      await expect
        .poll(async () => {
          pick = await findPick()
          return pick?.id
        })
        .toBeTruthy()
      const diagnostics: string[] = []
      page.on('console', (message) => {
        if (/Failed to add tag|No valid/.test(message.text())) {
          diagnostics.push(message.text())
        }
      })
      await page.mouse.click(pick!.x, pick!.y)
      await toolbar.expectSelection(
        fixture === 'split edge' ? '1 edge' : '1 face'
      )
      await cmdBar.openCmdBar()
      await page.getByPlaceholder('Search commands').fill('GDT Annotation')
      await page.keyboard.press('Enter')
      await modelingDialog.input('annotation').fill('Lineage check')
      await modelingDialog.submitButton.click()
      if (fixture === 'split edge') {
        await editor.expectEditor.toContain('gdt::annotation(')
        await editor.expectEditor.toContain(
          'endFaces = [baseRegion.tags.side3]'
        )
        await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
        await expect.poll(() => annotationEdges.length).toBe(1)
        const [target] = annotationEdges
        expect(target.end_faces?.length).toBeGreaterThan(0)
        const selectedIds = await page.evaluate(async (target) => {
          const { sendSceneCommand } = window.engineCommandManager
          const send = sendSceneCommand.bind(window.engineCommandManager)
          await send({
            type: 'modeling_cmd_req',
            cmd_id: crypto.randomUUID(),
            cmd: {
              type: 'select_entity',
              entities: [{ type: 'edge', ...target }],
            },
          })
          const response = await send({
            type: 'modeling_cmd_req',
            cmd_id: crypto.randomUUID(),
            cmd: { type: 'select_get' },
          })
          if (
            Array.isArray(response) ||
            !response ||
            !('resp' in response) ||
            response.resp.type !== 'modeling'
          )
            throw new Error('Missing selection response')
          const result = response.resp.data.modeling_response
          if (result.type !== 'select_get')
            throw new Error('Unexpected selection response')
          return result.data.entity_ids
        }, target)
        expect(selectedIds).toEqual([pick!.id])
      } else {
        await expect
          .poll(() => diagnostics.join(' '))
          .toContain(
            fixture === 'joined wall'
              ? 'No valid face or edge expressions could be generated'
              : 'No valid selections found. Please select faces or edges.'
          )
        await editor.expectEditor.not.toContain('gdt::annotation(')
        const target =
          fixture === 'joined wall'
            ? 'resolvedWall'
            : 'faceOf(instances[1], chamferFace = 0)'
        const diagnostic = await page.evaluate(
          async ({ main, target }) => {
            const manager = window.app.singletons.kclManager
            await manager.executeCode(
              main +
                `\nprobe = gdt::annotation(annotation = "Lineage check", faces = [${target}])\n`
            )
            return manager.errors.map(({ message }) => message)
          },
          { main, target }
        )
        expect(diagnostic).toEqual([
          expect.stringMatching(
            /faces requires one or more `TaggedFace`s.*array of `Face`/
          ),
        ])
      }
    }
  )
}
