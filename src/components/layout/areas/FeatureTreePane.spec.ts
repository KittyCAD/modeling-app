import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import {
  buildOperationTree,
  getFeatureTreeValueDetail,
  supportsZ0006AutoFixBeforeFeatureTreeEdit,
} from '@src/components/layout/areas/FeatureTreePane'
import { defaultSourceRange } from '@src/lang/sourceRange'
import { type OperationsByModule, defaultNodePath } from '@src/lang/wasm'
import { describe, expect, it } from 'vitest'

describe('FeatureTreePane', () => {
  describe('supportsZ0006AutoFixBeforeFeatureTreeEdit', () => {
    function stdLibCall(name: string): Operation {
      return {
        type: 'StdLibCall',
        name,
        unlabeledArg: null,
        labeledArgs: {},
        nodePath: defaultNodePath(),
        sourceRange: defaultSourceRange(),
        isError: false,
      }
    }

    it.each([
      'fillet',
      'chamfer',
      'extrude',
      'revolve',
      'helix',
      'mirror3d',
      'gdt::flatness',
      'gdt::straightness',
      'gdt::circularity',
      'gdt::cylindricity',
      'gdt::position',
      'gdt::profile',
      'gdt::profileLine',
      'gdt::profileSurface',
      'gdt::distance',
      'gdt::perpendicularity',
      'gdt::angularity',
      'gdt::concentricity',
      'gdt::symmetry',
      'gdt::runout',
      'gdt::parallelism',
      'gdt::annotation',
    ])('supports pre-edit Z0006 auto-fix for %s', (name) => {
      expect(supportsZ0006AutoFixBeforeFeatureTreeEdit(stdLibCall(name))).toBe(
        true
      )
    })

    it.each(['gdt::note', 'appearance', 'scale'])(
      'does not support pre-edit Z0006 auto-fix for %s',
      (name) => {
        expect(
          supportsZ0006AutoFixBeforeFeatureTreeEdit(stdLibCall(name))
        ).toBe(false)
      }
    )
  })

  describe('buildOperationTree', () => {
    function createModuleInstanceOperation(
      moduleId: number,
      sourceRange: [number, number, number],
      name = `module${moduleId}`
    ): Operation {
      return {
        type: 'ModuleInstance',
        name,
        moduleId,
        nodePath: defaultNodePath(),
        sourceRange,
      }
    }

    function createVariableDeclarationOperation(
      sourceRange: [number, number, number],
      name: string
    ): Operation {
      return {
        type: 'VariableDeclaration',
        name,
        value: { type: 'Number', value: 42 } as any,
        visibility: 'default',
        nodePath: defaultNodePath(),
        sourceRange,
      }
    }

    it('nests imported module operations under the root module instance', () => {
      const operationsByModule: OperationsByModule = {
        map: {
          0: [createModuleInstanceOperation(1, [0, 10, 0], 'Parameters')],
          1: [createVariableDeclarationOperation([0, 11, 1], 'length')],
        },
      }

      const tree = buildOperationTree(operationsByModule, 0)

      expect(tree[0]).toMatchObject({
        parent: { name: 'Parameters' },
        children: [{ name: 'length' }],
      })
    })

    it('car wheel assembly: modules first, children nested, parameters deduped', () => {
      // Models the car-wheel-assembly import graph:
      //   main.kcl (module 0)
      //     import * from "parameters.kcl"          -> module 1
      //     import "brake-rotor.kcl" as brakeRotor  -> module 2
      //     import "car-tire.kcl" as carTire        -> module 3
      //     import "car-wheel.kcl" as carWheel      -> module 4
      //     import "lug-nut.kcl" as lugNut          -> module 5
      //   Each of modules 2-5 also imports parameters.kcl (module 1).
      //
      // Expected tree from root (module 0):
      //   parameters (expanded, with children)
      //   brakeRotor (expanded, children include parameters as leaf)
      //   carTire    (expanded, children include parameters as leaf)
      //   carWheel   (expanded, children include parameters as leaf)
      //   lugNut     (expanded, children include parameters as leaf)
      //   lugNut |> patternCircular3d (stdlib call from main)

      const PARAMS = 1
      const ROTOR = 2
      const TIRE = 3
      const WHEEL = 4
      const LUG = 5

      const operationsByModule: OperationsByModule = {
        map: {
          // main.kcl operations
          0: [
            createModuleInstanceOperation(PARAMS, [0, 30, 0], 'parameters'),
            createModuleInstanceOperation(ROTOR, [31, 70, 0], 'brakeRotor'),
            createModuleInstanceOperation(TIRE, [71, 100, 0], 'carTire'),
            createModuleInstanceOperation(WHEEL, [101, 140, 0], 'carWheel'),
            createModuleInstanceOperation(LUG, [141, 170, 0], 'lugNut'),
          ],
          // parameters.kcl operations
          [PARAMS]: [
            createVariableDeclarationOperation([0, 20, PARAMS], 'lugCount'),
            createVariableDeclarationOperation([21, 40, PARAMS], 'wheelRadius'),
          ],
          // brake-rotor.kcl operations
          [ROTOR]: [
            createModuleInstanceOperation(PARAMS, [0, 30, ROTOR], 'parameters'),
            createVariableDeclarationOperation([31, 50, ROTOR], 'rotorSketch'),
          ],
          // car-tire.kcl operations
          [TIRE]: [
            createModuleInstanceOperation(PARAMS, [0, 30, TIRE], 'parameters'),
            createVariableDeclarationOperation([31, 50, TIRE], 'tireSketch'),
          ],
          // car-wheel.kcl operations
          [WHEEL]: [
            createModuleInstanceOperation(PARAMS, [0, 30, WHEEL], 'parameters'),
            createVariableDeclarationOperation([31, 50, WHEEL], 'wheelSketch'),
          ],
          // lug-nut.kcl operations
          [LUG]: [
            createModuleInstanceOperation(PARAMS, [0, 30, LUG], 'parameters'),
            createVariableDeclarationOperation([31, 50, LUG], 'lugSketch'),
          ],
        },
      }

      const tree = buildOperationTree(operationsByModule, 0)

      // 1. Imports come first: the first 5 items are module instances
      //    (parameters, brakeRotor, carTire, carWheel, lugNut)
      expect(tree.length).toBe(5)

      // 2. First item: parameters is expanded with children
      expect(tree[0]).toMatchObject({
        parent: { name: 'parameters', moduleId: PARAMS },
        children: [{ name: 'lugCount' }, { name: 'wheelRadius' }],
      })

      // 3. brakeRotor is expanded; its parameters reference is a leaf (not a branch)
      const brakeRotor = tree[1] as any
      expect(brakeRotor.parent).toMatchObject({
        name: 'brakeRotor',
        moduleId: ROTOR,
      })
      // parameters inside brakeRotor should be a leaf operation, not an expanded branch
      const brakeRotorParams = brakeRotor.children.find(
        (c: any) => c.type === 'ModuleInstance' && c.name === 'parameters'
      )
      expect(brakeRotorParams).toBeDefined()
      expect(brakeRotorParams).not.toHaveProperty('children')

      // 4. Same for carTire
      const carTire = tree[2] as any
      expect(carTire.parent).toMatchObject({
        name: 'carTire',
        moduleId: TIRE,
      })
      const carTireParams = carTire.children.find(
        (c: any) => c.type === 'ModuleInstance' && c.name === 'parameters'
      )
      expect(carTireParams).toBeDefined()
      expect(carTireParams).not.toHaveProperty('children')

      // 5. Same for carWheel
      const carWheel = tree[3] as any
      expect(carWheel.parent).toMatchObject({
        name: 'carWheel',
        moduleId: WHEEL,
      })
      const carWheelParams = carWheel.children.find(
        (c: any) => c.type === 'ModuleInstance' && c.name === 'parameters'
      )
      expect(carWheelParams).toBeDefined()
      expect(carWheelParams).not.toHaveProperty('children')

      // 6. Same for lugNut
      const lugNut = tree[4] as any
      expect(lugNut.parent).toMatchObject({
        name: 'lugNut',
        moduleId: LUG,
      })
      const lugNutParams = lugNut.children.find(
        (c: any) => c.type === 'ModuleInstance' && c.name === 'parameters'
      )
      expect(lugNutParams).toBeDefined()
      expect(lugNutParams).not.toHaveProperty('children')
    })

    it('deduplicates ModuleInstance when multiple modules import the same module', () => {
      const operationsByModule: OperationsByModule = {
        map: {
          0: [createModuleInstanceOperation(1, [0, 10, 0], 'first')],
          2: [createModuleInstanceOperation(1, [0, 11, 2], 'second')],
        },
      }

      const tree = buildOperationTree(operationsByModule, 0)

      // Module 1 is expanded once (from module 0's "first" reference).
      // Module 2's "second" reference to the same module is not added
      // as a top-level branch.
      expect(JSON.stringify(tree)).toContain('first')
      expect(JSON.stringify(tree)).not.toContain('second')
    })
  })

  describe('getFeatureTreeValueDetail', () => {
    describe('VariableDeclaration operations', () => {
      function createVariableDeclarationOperation(
        sourceRange: [number, number, number],
        value: any,
        name: string
      ): Operation {
        return {
          type: 'VariableDeclaration',
          name,
          value,
          visibility: 'default',
          nodePath: defaultNodePath(),
          sourceRange,
        }
      }

      it('should extract variable name and value from VariableDeclaration operation', () => {
        const mockCode = 'const myVariable = 42'
        const sourceRange: [number, number, number] = [0, mockCode.length, 0]
        const mockValue = { type: 'Number', value: 42 }
        const mockOperation = createVariableDeclarationOperation(
          sourceRange,
          mockValue,
          'myVariable'
        )

        const valueDetail = getFeatureTreeValueDetail(mockOperation, mockCode)

        expect(valueDetail?.display).toBe('const myVariable = 42')
        expect(valueDetail?.calculated).toEqual(mockValue)
      })
    })

    describe('datum name extraction', () => {
      function createGdtDatumOperation(
        nameSourceRange: [number, number, number]
      ): Operation {
        return {
          type: 'StdLibCall',
          name: 'gdt::datum',
          unlabeledArg: null,
          labeledArgs: {
            name: {
              value: { type: 'String', value: 'A' },
              sourceRange: nameSourceRange,
            },
          },
          nodePath: defaultNodePath(),
          sourceRange: defaultSourceRange(),
          isError: false,
        }
      }

      it('should extract datum name from GDT datum operation', () => {
        const mockCode = 'gdt::datum(face = extrude001, name = "A")'
        // Calculate sourceRange positions dynamically
        const nameStart = mockCode.indexOf('"A"')
        const nameEnd = nameStart + 3 // Length of "A" including quotes
        const nameSourceRange: [number, number, number] = [
          nameStart,
          nameEnd,
          0,
        ]
        const mockOperation = createGdtDatumOperation(nameSourceRange)

        const valueDetail = getFeatureTreeValueDetail(mockOperation, mockCode)

        expect(valueDetail?.display).toBe('A')
        expect(valueDetail?.calculated).toEqual({ type: 'String', value: 'A' })
      })
    })
  })
})
