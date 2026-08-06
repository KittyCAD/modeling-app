import stdLibConstants from '@rust/kcl-lib/bindings/StdLibConstants'
import {
  KCL_PRELUDE_BODY_TYPE_SOLID,
  KCL_PRELUDE_BODY_TYPE_SURFACE,
  KCL_PRELUDE_BODY_TYPE_VALUES,
  KCL_PRELUDE_EXTRUDE_METHOD_MERGE,
  KCL_PRELUDE_EXTRUDE_METHOD_NEW,
  KCL_PRELUDE_EXTRUDE_METHOD_VALUES,
  type KclPreludeBodyType,
  type KclPreludeExtrudeMethod,
} from '@src/lib/constants'
import { describe, expect, expectTypeOf, it } from 'vitest'

describe('generated KCL prelude identifiers', () => {
  it('keeps body type identifiers and their public ordering in sync', () => {
    expect(KCL_PRELUDE_BODY_TYPE_SURFACE).toBe(stdLibConstants.SURFACE.name)
    expect(KCL_PRELUDE_BODY_TYPE_SOLID).toBe(stdLibConstants.SOLID.name)
    expect(KCL_PRELUDE_BODY_TYPE_VALUES).toEqual(['SURFACE', 'SOLID'])

    expectTypeOf<KclPreludeBodyType>().toEqualTypeOf<'SURFACE' | 'SOLID'>()
  })

  it('keeps extrude method identifiers and their public ordering in sync', () => {
    expect(KCL_PRELUDE_EXTRUDE_METHOD_MERGE).toBe(stdLibConstants.MERGE.name)
    expect(KCL_PRELUDE_EXTRUDE_METHOD_NEW).toBe(stdLibConstants.NEW.name)
    expect(KCL_PRELUDE_EXTRUDE_METHOD_VALUES).toEqual(['NEW', 'MERGE'])

    expectTypeOf<KclPreludeExtrudeMethod>().toEqualTypeOf<'MERGE' | 'NEW'>()
  })
})
