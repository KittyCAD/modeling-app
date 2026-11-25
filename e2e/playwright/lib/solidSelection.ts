import type { Page } from '@playwright/test'

export function getEndCapId(page: Page, solidName: string) {
  return page.evaluate((name) => {
    const solid = window.app.singletons.kclManager.variables[name]
    if (solid?.type !== 'Solid' || !solid.value.endCapId) {
      throw new Error(`Expected ${name} to be a solid with an end cap`)
    }
    return solid.value.endCapId
  }, solidName)
}

export function getImportedEndCapId(page: Page, filename: string) {
  return page.evaluate((filename) => {
    const { ast, artifactGraph } = window.app.singletons.kclManager
    const statement = ast.body.find(
      (node) =>
        node.type === 'ImportStatement' &&
        node.path.type === 'Kcl' &&
        node.path.filename === filename
    )
    if (!statement) throw new Error(`No KCL import for ${filename}`)

    const caps = [...artifactGraph.values()].filter((face) => {
      if (face.type !== 'cap' || face.subType !== 'end') return false
      const sweep = artifactGraph.get(face.sweepId)
      if (sweep?.type !== 'sweep') return false
      const [start, end, moduleId] = sweep.codeRef.range
      return (
        start === statement.start &&
        end === statement.end &&
        moduleId === statement.moduleId
      )
    })
    if (caps.length !== 1) {
      throw new Error(
        `Expected one end cap for ${filename}, found ${caps.length}`
      )
    }
    return caps[0].id
  }, filename)
}
