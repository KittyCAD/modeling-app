import { exportSave } from '@src/lib/exportSave'
import type { Command } from '@src/lib/commandTypes'
import {
  CLIENT_COMMAND_SCHEMA_REVISION,
  createClientCommandSchemaUpdate,
  type ExecuteClientCommandDependencies,
  executeClientCommand,
  isClientCommandAvailable,
  parseClientCommandRequest,
} from '@src/lib/zookeeper/clientCommands'
import {
  DEFAULT_COMMAND_SCOPES,
  MODE_MODELING_COMMAND_SCOPE,
  MODE_SKETCHING_COMMAND_SCOPE,
} from '@src/registry/contracts/commands'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/exportSave', () => ({
  exportSave: vi.fn().mockResolvedValue({ status: 'saved' }),
}))

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    loading: vi.fn(() => 'toast-id'),
  },
}))

describe('Zookeeper client commands', () => {
  const exportCommand = {
    groupId: 'modeling',
    name: 'Export',
    displayName: 'Export current part',
    description: 'Export the active part.',
    needsReview: true,
    onSubmit: vi.fn(),
  } as unknown as Command

  const exportRequest = {
    request_id: 'request-1',
    catalog_revision: CLIENT_COMMAND_SCHEMA_REVISION,
    command_id: 'modeling.export',
    arguments: { format: 'step' },
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('advertises only the explicit STEP export capability', () => {
    expect(createClientCommandSchemaUpdate([exportCommand])).toEqual({
      type: 'update_client_command_schema',
      protocol_version: 1,
      revision: CLIENT_COMMAND_SCHEMA_REVISION,
      commands: [
        expect.objectContaining({
          id: 'modeling.export',
          title: 'Export current part',
          description: 'Export the active part.',
          input_schema: expect.objectContaining({
            required: ['format'],
            additionalProperties: false,
          }),
        }),
      ],
    })
    expect(createClientCommandSchemaUpdate([]).commands).toEqual([])
    expect(
      createClientCommandSchemaUpdate([{ ...exportCommand, disabled: true }])
        .commands
    ).toEqual([])
  })

  it('uses scopes as runtime readiness without removing the capability', () => {
    const scopedExport = {
      ...exportCommand,
      scopes: [MODE_MODELING_COMMAND_SCOPE],
    } as Command

    expect(
      createClientCommandSchemaUpdate([scopedExport]).commands
    ).toHaveLength(1)
    expect(
      isClientCommandAvailable(
        exportRequest,
        [scopedExport],
        [MODE_SKETCHING_COMMAND_SCOPE],
        DEFAULT_COMMAND_SCOPES
      )
    ).toBe(false)
    expect(
      isClientCommandAvailable(
        exportRequest,
        [scopedExport],
        [MODE_MODELING_COMMAND_SCOPE],
        DEFAULT_COMMAND_SCOPES
      )
    ).toBe(true)
  })

  it('parses the externally tagged server request', () => {
    expect(
      parseClientCommandRequest({
        client_command_request: {
          request_id: 'request-1',
          catalog_revision: 1,
          command_id: 'modeling.export',
          arguments: { format: 'step' },
        },
      })
    ).toEqual({
      request_id: 'request-1',
      catalog_revision: 1,
      command_id: 'modeling.export',
      arguments: { format: 'step' },
    })
    expect(parseClientCommandRequest({ delta: { delta: 'hello' } })).toBe(
      undefined
    )
  })

  it('exports through the active client Engine and waits for the save flow', async () => {
    const waitForProjectIdle = vi.fn().mockResolvedValue(undefined)
    const exportFromEngine = vi.fn().mockResolvedValue([
      {
        name: 'engine-output.step',
        contents: new Uint8Array([1, 2, 3]),
      },
    ])
    const kclManager = {
      ast: { body: [{}] },
      currentFileName: 'main.kcl',
      hasErrors: () => false,
      rustContext: { export: exportFromEngine },
    } as unknown as ExecuteClientCommandDependencies['kclManager']

    const result = await executeClientCommand(exportRequest, {
      kclManager,
      defaultUnit: 'mm',
      waitForProjectIdle,
    })

    expect(waitForProjectIdle).toHaveBeenCalledOnce()
    expect(exportFromEngine).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'step', units: 'mm' }),
      { settings: { modeling: { base_unit: 'mm' } } },
      'toast-id'
    )
    expect(exportSave).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'main.step' })
    )
    expect(result).toEqual(
      expect.objectContaining({ status: 'succeeded', request_id: 'request-1' })
    )
  })

  it.each([
    [{ status: 'cancelled' }, 'cancelled'],
    [{ status: 'failed', error: new Error('disk full') }, 'failed'],
  ] as const)('reports a %s save as %s', async (saveResult, status) => {
    vi.mocked(exportSave).mockResolvedValueOnce(saveResult)
    const kclManager = {
      ast: { body: [{}] },
      currentFileName: 'main.kcl',
      hasErrors: () => false,
      rustContext: {
        export: vi.fn().mockResolvedValue([
          {
            name: 'engine-output.step',
            contents: new Uint8Array([1, 2, 3]),
          },
        ]),
      },
    } as unknown as ExecuteClientCommandDependencies['kclManager']

    const result = await executeClientCommand(exportRequest, {
      kclManager,
      defaultUnit: 'mm',
      waitForProjectIdle: vi.fn().mockResolvedValue(undefined),
    })

    expect(result.status).toBe(status)
    if (status === 'failed') {
      expect(result.error).toBe('disk full')
    }
  })
})
