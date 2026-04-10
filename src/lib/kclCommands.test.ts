import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { KclManager } from '@src/lang/KclManager'
import * as wasm from '@src/lang/wasm'
import { kclCommands } from '@src/lib/kclCommands'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

function createCommandProps(overrides: Partial<KclManager> = {}) {
  const sendModelingEvent = vi.fn().mockReturnValue(false)
  const modelingState = { matches: vi.fn().mockReturnValue(false) } as any
  const updateCodeEditor = vi.fn()
  const safeParse = vi.fn()

  const kclManager = {
    ast: { body: [] },
    code: 'fresh code from editor',
    wasmInstancePromise: Promise.resolve({} as ModuleType),
    fileSettings: {},
    variables: {},
    isExecuting: false,
    execState: { operations: [] },
    format: vi.fn(),
    safeParse,
    updateCodeEditor,
    rustContext: {},
    sendModelingEvent,
    modelingState,
    ...overrides,
  } as unknown as KclManager

  return {
    specialPropsForInsertCommand: {
      providedOptions: [],
    },
    kclManager,
    systemIOActor: {
      getSnapshot: () => ({ context: {} }),
    },
    wasmInstance: {} as ModuleType,
    projectData: {} as any,
    authToken: '',
    settings: {
      defaultUnit: 'mm' as const,
    },
    __mocks: {
      sendModelingEvent,
      modelingState,
      safeParse,
      updateCodeEditor,
    },
  } as any
}

describe('parameter.create command', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('re-parses current code, inserts the variable declaration, and updates the editor', async () => {
    const commandProps = createCommandProps()
    const freshAst = {
      body: [{ type: 'ExpressionStatement', start: 0, end: 4 }],
    } as any
    commandProps.__mocks.safeParse.mockResolvedValue(freshAst)
    vi.spyOn(wasm, 'recast').mockReturnValue('myParameter = 5\ncube = 1')

    const command = kclCommands(commandProps).find(
      (candidate) => candidate.name === 'parameter.create'
    )
    expect(command).toBeDefined()

    void command!.onSubmit({
      value: {
        variableName: 'myParameter',
        valueText: '5',
        insertIndex: 1,
        variableDeclarationAst: {
          type: 'VariableDeclaration',
        },
      },
    } as any)
    await Promise.resolve()
    await Promise.resolve()

    expect(commandProps.__mocks.safeParse).toHaveBeenCalledWith(
      'fresh code from editor',
      commandProps.kclManager.wasmInstancePromise
    )
    expect(commandProps.__mocks.sendModelingEvent).not.toHaveBeenCalled()
    expect(commandProps.__mocks.updateCodeEditor).toHaveBeenCalledWith(
      'myParameter = 5\ncube = 1',
      {
        shouldExecute: true,
        shouldWriteToDisk: true,
        shouldAddToHistory: true,
      }
    )
  })

  it('still uses direct editor update in sketch mode', async () => {
    const commandProps = createCommandProps()
    commandProps.__mocks.modelingState.matches.mockReturnValue(true)
    commandProps.__mocks.safeParse.mockResolvedValue({ body: [] } as any)
    vi.spyOn(wasm, 'recast').mockReturnValue('myParameter = 8')

    const command = kclCommands(commandProps).find(
      (candidate) => candidate.name === 'parameter.create'
    )
    expect(command).toBeDefined()

    void command!.onSubmit({
      value: {
        variableName: 'myParameter',
        valueText: '8',
        insertIndex: 0,
        variableDeclarationAst: {
          type: 'VariableDeclaration',
        },
      },
    } as any)
    await Promise.resolve()
    await Promise.resolve()

    expect(commandProps.__mocks.sendModelingEvent).not.toHaveBeenCalled()
    expect(commandProps.__mocks.updateCodeEditor).toHaveBeenCalledWith(
      'myParameter = 8',
      {
        shouldExecute: true,
        shouldWriteToDisk: true,
        shouldAddToHistory: true,
      }
    )
  })
})
