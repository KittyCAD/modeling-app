import '../../../scripts/register-typescript-eslint-typescript.cjs'
import { ESLint, RuleTester } from 'eslint'
import tsParser from '@typescript-eslint/parser'
import { afterAll, describe, expect, it } from 'vitest'
import createPerformanceDirectivesProcessor from '../performance-directives.mjs'
import rule from './no-wasm-runtime-construction.mjs'

RuleTester.afterAll = afterAll
RuleTester.describe = describe
RuleTester.it = it

const production = '/repo/src/components/Feature.ts'
const generated = '@rust/kcl-wasm-lib/pkg/kcl_wasm_lib'
const wrapper = '@src/lib/wasm_lib_wrapper'
const rustContext = '@src/lib/rustContext'
const moduleImport = `import { getModule } from '${wrapper}';`
const moduleType = `import type { ModuleType } from '${wrapper}';`

const tester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
})

tester.run('no-wasm-runtime-construction', rule, {
  valid: [
    ...[
      `import type { Context } from '${generated}'; let handle: Context;`,
      `import type RustContext from '${rustContext}'; let owner: RustContext;`,
      `export type { Context } from '${generated}';`,
      `export type { default as RustContext } from '${rustContext}';`,
      `${moduleImport} getModule().parse_wasm('source');`,
      `${moduleImport} const key = 'parse_wasm'; getModule()[key]('source');`,
      `import * as wasm from '${generated}'; wasm.parse_wasm('source');`,
      `import { createContext } from 'react'; createContext(null);`,
      `const Unrelated = { Context: class {} }; new Unrelated.Context();`,
      `const object = { Context: class {} }; const { Context: Factory } = object; new Factory();`,
      `import { initialiseWasm } from '@src/lang/wasmUtils'; initialiseWasm();`,
      `import * as utils from '@src/lang/wasmUtils'; utils.initialiseWasm();`,
      `Reflect.get(object, 'Context');`,
      `function useValue(instance: UnrelatedModuleType) { return instance.Context; }`,
    ].map((code) => ({ code, filename: production })),
    {
      code: `${moduleImport} const Factory = getModule().Context; new Factory();`,
      filename: '/repo/src/lib/rustContext/index.ts',
    },
    {
      code: `import type { Context } from '${generated}'; function clone(instance: Context) { return instance.cloneWithExecuteCallbacks(callbacks); }`,
      filename: '/repo/src/lib/rustContext/index.ts',
    },
    {
      code: `import RuntimeOwner from '${rustContext}'; new RuntimeOwner(modulePromise, manager, settings);`,
      filename: '/repo/src/lib/rustContext/registry/extension.ts',
    },
    {
      code: `import { restartWasmModule } from '@src/lang/wasmUtils'; owner.replaceWasmInstance(restartWasmModule());`,
      filename: '/repo/src/lib/exceptions.ts',
    },
    ...[
      '/repo/src/unitTestUtils.ts',
      '/repo/src/lib/rustContext/lifecycle.test.ts',
      '/repo/src/lang/wasm.spec.ts',
    ].map((filename) => ({
      filename,
      code: `import { Context } from '${generated}'; import RustContext from '${rustContext}'; new Context(); new RustContext(); owner.replaceWasmInstance(replacement);`,
    })),
  ],
  invalid: [
    ...[
      `import { Context } from '${generated}';`,
      `import { Context as Factory } from '${generated}'; new Factory();`,
      `export { Context as Factory } from '${generated}';`,
      `import * as wasm from '${generated}'; const Factory = wasm.Context;`,
      `import * as wasm from '${generated}'; const first = wasm; const second = first; new second.Context();`,
      `const wasm = await import('${generated}'); const Factory = wasm.Context;`,
      `const source = '${generated}'; const wasm = await import(source); const Factory = wasm.Context;`,
      `${moduleImport} const Factory = getModule().Context; new Factory();`,
      `${moduleImport} const load = getModule; const wasm = load(); const Factory = wasm.Context;`,
      `${moduleImport} const key = 'Context'; const Factory = getModule()[key];`,
      `${moduleImport} const key = 'Context'; const { [key]: Factory } = getModule();`,
      `${moduleImport} const { Context: Factory } = getModule();`,
      `${moduleImport} const Factory = Reflect.get(getModule(), 'Context');`,
      `${moduleImport} const key = 'Context'; const Factory = Reflect.get(getModule(), key);`,
      `${moduleImport} const read = Reflect.get; const Factory = read(getModule(), 'Context');`,
      `const wasm = await app.wasmInstancePromise; const Factory = wasm.Context;`,
      `const wasm = await app.wasmPromise; const { Context } = wasm;`,
      `const Factory = app.activeWasmInstance.Context;`,
      `const { wasmPromise } = useApp(); const wasm = await wasmPromise; new wasm.Context(manager, fs);`,
      `const { activeWasmInstance: wasm } = app; new wasm.Context(manager, fs);`,
      `const key = 'wasmPromise'; const { [key]: promise } = app; const wasm = await promise; new wasm.Context(manager, fs);`,
      `const { wasmInstancePromise: promise = fallback } = app; const wasm = await promise; new wasm.Context(manager, fs);`,
      `${moduleType} function allocate(instance: ModuleType) { return instance.Context; }`,
      `${moduleType} async function allocate(instance: Promise<ModuleType>) { return (await instance).Context; }`,
      `import type { ModuleType as Runtime } from '${wrapper}'; function allocate(instance: Runtime | undefined) { return instance?.Context; }`,
      `${moduleType} const wasm: ModuleType = source; const Factory = wasm.Context;`,
      `import { initialiseWasm as load } from '@src/lang/wasmUtils'; const Factory = (await load()).Context;`,
      `import type { Context as Native } from '${generated}'; function clone(instance: Native) { return instance.cloneWithExecuteCallbacks; }`,
      `import type { Context } from '${generated}'; function clone(instance: Context) { return Reflect.get(instance, 'cloneWithExecuteCallbacks'); }`,
      `${moduleImport} // zds-performance-exception: resource-cleanup -- Reallocate resources after a settings change in this component.\nnew (getModule().Context)();`,
    ].map((code) => ({
      filename: production,
      code,
      errors: [{ messageId: 'native' }],
    })),
    ...[
      `export * from '${generated}';`,
      `${moduleImport} const Factory = getModule()[unknownKey];`,
      `${moduleImport} const Factory = Reflect.get(getModule(), unknownKey);`,
    ].map((code) => ({
      filename: production,
      code,
      errors: [{ messageId: 'opaque' }],
    })),
    ...[
      `import RustContext from '${rustContext}'; new RustContext();`,
      `import Runtime from '${rustContext}'; const Factory = Runtime; new Factory();`,
      `import { default as Runtime } from '${rustContext}';`,
      `import * as Runtime from '${rustContext}'; new Runtime.default();`,
      `export { default as Runtime } from '${rustContext}';`,
      `export * from '${rustContext}';`,
      `const { default: Factory } = await import('${rustContext}');`,
      `import Runtime from '../lib/rustContext'; new Runtime();`,
    ].map((code) => ({
      filename: production,
      code,
      errors: [{ messageId: 'wrapper' }],
    })),
    ...[
      `owner.replaceWasmInstance(replacement);`,
      `const replace = owner.replaceWasmInstance;`,
      `const { replaceWasmInstance: replace } = owner;`,
      `const key = 'replaceWasmInstance'; owner[key](replacement);`,
      `const replace = Reflect.get(owner, 'replaceWasmInstance');`,
      `const read = Reflect.get; const replace = read(owner, 'replaceWasmInstance');`,
      `import { restartWasmModule } from '@src/lang/wasmUtils'; restartWasmModule();`,
      `import { restartWasmModule as restart } from '@src/lang/wasmUtils'; const reset = restart;`,
      `export { restartWasmModule as restart } from '@src/lang/wasmUtils';`,
      `export * from '@src/lang/wasmUtils';`,
      `import * as utils from '@src/lang/wasmUtils'; const restart = utils.restartWasmModule;`,
      `import * as utils from '@src/lang/wasmUtils'; const alias = utils; const key = 'restartWasmModule'; const restart = alias[key];`,
      `import * as utils from '@src/lang/wasmUtils'; const { restartWasmModule: restart } = utils;`,
      `const utils = await import('@src/lang/wasmUtils'); const restart = Reflect.get(utils, 'restartWasmModule');`,
    ].map((code) => ({
      filename: production,
      code,
      errors: [{ messageId: 'recovery' }],
    })),
    {
      filename: production,
      code: `import * as utils from '@src/lang/wasmUtils'; const { Context: Factory } = await utils.restartWasmModule();`,
      errors: [{ messageId: 'native' }, { messageId: 'recovery' }],
    },
    {
      filename: '/repo/src/lib/exceptions.ts',
      code: `${moduleImport} new (getModule().Context)();`,
      errors: [{ messageId: 'native' }],
    },
    {
      filename: '/repo/src/lib/rustContext/registry/extension.ts',
      code: `${moduleImport} new (getModule().Context)();`,
      errors: [{ messageId: 'native' }],
    },
  ],
})

describe('native ESLint runtime guard boundary', () => {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.ts'],
        languageOptions: { parser: tsParser },
        plugins: { zds: { rules: { 'no-wasm-runtime-construction': rule } } },
        processor: createPerformanceDirectivesProcessor(),
        linterOptions: { reportUnusedDisableDirectives: false },
        rules: { 'zds/no-wasm-runtime-construction': 'error' },
      },
    ],
  })
  const filePath = 'src/components/RuntimeGuardExample.ts'

  for (const directive of [
    '/* eslint-disable */',
    '/* eslint-disable zds/no-wasm-runtime-construction */',
    '/* eslint zds/no-wasm-runtime-construction: off */',
  ])
    it(`rejects inline suppression: ${directive}`, async () => {
      const [result] = await eslint.lintText(
        `${directive}\n${moduleImport} const Factory = getModule().Context;`,
        { filePath }
      )
      expect(result.messages.some((message) => message.fatal)).toBe(true)
      expect(result.errorCount).toBeGreaterThan(0)
    })

  it('reports ordinary construction without changing unrelated React contexts', async () => {
    const [invalid] = await eslint.lintText(
      `${moduleImport} const Factory = getModule().Context;`,
      { filePath }
    )
    expect(invalid.messages).toMatchObject([
      { ruleId: 'zds/no-wasm-runtime-construction', messageId: 'native' },
    ])
    const [valid] = await eslint.lintText(
      `import { createContext } from 'react'; createContext(null);`,
      { filePath }
    )
    expect(valid.messages).toEqual([])
  })
})
