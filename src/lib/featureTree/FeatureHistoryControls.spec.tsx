import { join } from 'node:path'
import { assertParse } from '@src/lang/wasm'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import { FeatureHistoryControls } from '@src/lib/featureTree/FeatureHistoryControls'
import {
  getFeatureHistory,
  ROLLBACK_CODE,
  setHistoryRollback,
} from '@src/lib/featureTree/featureHistory'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

let instance: ModuleType
beforeAll(async () => {
  instance = await loadAndInitialiseWasmInstance(
    join(process.cwd(), 'rust/kcl-wasm-lib/pkg/kcl_wasm_lib_bg.wasm')
  )
})

function history(code: string) {
  return getFeatureHistory(assertParse(code, instance), code)
}

describe('feature history imports and hidden calls', () => {
  it('allows rollback with a wildcard import that does not bind exit', async () => {
    const code =
      '@settings(kclVersion = 3.0, experimentalFeatures = allow)\nimport * from "std::math"\na = 1\nb = 2\n'
    const context = new instance.Context({}, {})
    try {
      const result = await context.executeMock(
        JSON.stringify(assertParse(code, instance)),
        undefined,
        JSON.stringify(instance.default_app_settings()),
        false
      )
      expect(result.variables.exit).toBeUndefined()
      const onChange = vi.fn()
      render(
        <FeatureHistoryControls
          history={history(code)}
          disabled={false}
          hasImportedExitBinding={result.variables.exit !== undefined}
          onChange={onChange}
          renderBlock={(block) => block.label}
        />
      )
      fireEvent.keyDown(screen.getByRole('slider', { name: 'Rollback bar' }), {
        key: 'ArrowUp',
      })
      expect(onChange).toHaveBeenCalledWith(
        code.replace('b = 2', ROLLBACK_CODE + 'b = 2')
      )
    } finally {
      context.free()
    }
  })

  it('still prevents calling an exit binding exported by a wildcard import', () => {
    const code =
      '@settings(kclVersion = 3.0)\nimport * from "part.kcl"\na = 1\nb = 2\n'
    const onChange = vi.fn()
    render(
      <FeatureHistoryControls
        history={history(code)}
        disabled={false}
        hasImportedExitBinding
        onChange={onChange}
        renderBlock={(block) => block.label}
      />
    )
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowUp' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('allows a project wildcard import when execution has no exit binding', () => {
    const code =
      '@settings(kclVersion = 3.0)\nimport * from "part.kcl"\na = 1\nb = 2\n'
    const onChange = vi.fn()
    render(
      <FeatureHistoryControls
        history={history(code)}
        disabled={false}
        hasImportedExitBinding={false}
        onChange={onChange}
        renderBlock={(block) => block.label}
      />
    )
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowUp' })
    expect(onChange).toHaveBeenCalledWith(
      code.replace('b = 2', ROLLBACK_CODE + 'b = 2')
    )
  })

  it.each(['import * from "std::runtime"', 'import exit from "std::runtime"'])(
    'allows importing the built-in exit: %s',
    (importCode) => {
      const code =
        '@settings(kclVersion = 3.0, experimentalFeatures = allow)\n' +
        importCode +
        '\na = 1\nb = 2\n'
      const onChange = vi.fn()
      render(
        <FeatureHistoryControls
          history={history(code)}
          disabled={false}
          hasImportedExitBinding
          onChange={onChange}
          renderBlock={(block) => block.label}
        />
      )
      fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowUp' })
      expect(onChange).toHaveBeenCalledWith(
        code.replace('b = 2', ROLLBACK_CODE + 'b = 2')
      )
    }
  )

  it.each(['exit = 1', 'import abs as exit from "std::math"'])(
    'still protects a real exit shadow: %s',
    (binding) => {
      const code =
        '@settings(kclVersion = 3.0, experimentalFeatures = allow)\n' +
        binding +
        '\na = 1\nb = 2\n'
      const onChange = vi.fn()
      render(
        <FeatureHistoryControls
          history={history(code)}
          disabled={false}
          onChange={onChange}
          renderBlock={(block) => block.label}
        />
      )
      fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowUp' })
      expect(onChange).not.toHaveBeenCalled()
    }
  )

  it('omits standalone, assigned and pipeline hide calls while preserving their source', () => {
    const code =
      '@settings(kclVersion = 3.0)\na = 1\nhide(XY)\nhidden = hide(YZ)\nplanes = [XY]\n  |> hide()\nb = 2\n'
    const sourceHistory = history(code)
    expect(sourceHistory.blocks.filter((block) => block.hidden)).toHaveLength(3)
    const onChange = vi.fn()
    render(
      <FeatureHistoryControls
        history={sourceHistory}
        disabled={false}
        onChange={onChange}
        renderBlock={(block) => <span>{block.label}</span>}
      />
    )
    expect(screen.queryByText('hide(XY)')).not.toBeInTheDocument()
    expect(screen.queryByText('hidden')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Move hide' })
    ).not.toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(3)
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '3')
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowUp' })
    expect(onChange).toHaveBeenCalledWith(
      code.replace('b = 2', ROLLBACK_CODE + 'b = 2')
    )
    expect(
      setHistoryRollback(history(setHistoryRollback(sourceHistory, 5)), 6)
    ).toBe(code)
  })

  it('keeps a persisted rollback bar visible next to omitted hide calls', () => {
    const code =
      '@settings(kclVersion = 3.0)\na = 1\n' +
      ROLLBACK_CODE +
      'hide(XY)\nb = 2\n'
    const onChange = vi.fn()
    render(
      <FeatureHistoryControls
        history={history(code)}
        disabled={false}
        onChange={onChange}
        renderBlock={(block) => block.label}
      />
    )
    const bar = screen.getByRole('slider', { name: 'Rollback bar' })
    expect(bar).toHaveAttribute('aria-valuenow', '1')
    fireEvent.keyDown(bar, { key: 'End' })
    expect(onChange).toHaveBeenCalledWith(
      '@settings(kclVersion = 3.0)\na = 1\nhide(XY)\nb = 2\n'
    )
  })
})
