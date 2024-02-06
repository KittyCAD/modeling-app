import {
  PathToNode,
  SketchGroup,
  VariableDeclaration,
  VariableDeclarator,
} from 'lang/wasm'
import { engineCommandManager } from 'lang/std/engineConnection'
import { isReducedMotion } from 'lib/utils'
import {
  Axis,
  Selection,
  SelectionRangeTypeMap,
  Selections,
} from 'lib/selections'
import { assign, createMachine } from 'xstate'
import { v4 as uuidv4 } from 'uuid'
import { isCursorInSketchCommandRange } from 'lang/util'
import { getNodePathFromSourceRange } from 'lang/queryAst'
import { kclManager } from 'lang/KclSingleton'
import {
  horzVertInfo,
  applyConstraintHorzVert,
} from 'components/Toolbar/HorzVert'
import {
  applyConstraintHorzVertAlign,
  horzVertDistanceInfo,
} from 'components/Toolbar/SetHorzVertDistance'
import { angleBetweenInfo } from 'components/Toolbar/SetAngleBetween'
import { angleLengthInfo } from 'components/Toolbar/setAngleLength'
import {
  applyConstraintEqualLength,
  setEqualLengthInfo,
} from 'components/Toolbar/EqualLength'
import {
  addStartProfileAt,
  extrudeSketch,
  startSketchOnDefault,
} from 'lang/modifyAst'
import { getNodeFromPath } from '../lang/queryAst'
import { CallExpression, PipeExpression } from '../lang/wasm'
import { getConstraintLevelFromSourceRange } from 'lang/std/sketchcombos'
import {
  applyConstraintEqualAngle,
  equalAngleInfo,
} from 'components/Toolbar/EqualAngle'
import {
  applyRemoveConstrainingValues,
  removeConstrainingValuesInfo,
} from 'components/Toolbar/RemoveConstrainingValues'
import { intersectInfo } from 'components/Toolbar/Intersect'
import {
  absDistanceInfo,
  applyConstraintAxisAlign,
} from 'components/Toolbar/SetAbsDistance'
import { Models } from '@kittycad/lib/dist/types/src'
import { ModelingCommandSchema } from 'lib/commandBarConfigs/modelingCommandConfig'
import {
  DefaultPlaneStr,
  clientSideScene,
  quaternionFromSketchGroup,
} from 'clientSideScene/clientSideScene'
import { isQuaternionVertical, setupSingleton } from 'clientSideScene/setup'
import { PerspectiveCamera } from 'three'

export const MODELING_PERSIST_KEY = 'MODELING_PERSIST_KEY'

export type SetSelections =
  | {
      selectionType: 'singleCodeCursor'
      selection?: Selection
    }
  | {
      selectionType: 'otherSelection'
      selection: Axis
    }
  | {
      selectionType: 'completeSelection'
      selection: Selections
    }
  | {
      selectionType: 'mirrorCodeMirrorSelections'
      selection: Selections
    }

export type ModelingMachineEvent =
  | { type: 'Deselect all' }
  | { type: 'Deselect edge'; data: Selection & { type: 'edge' } }
  | { type: 'Deselect axis'; data: Axis }
  | {
      type: 'Deselect segment'
      data: Selection & { type: 'line' | 'arc' }
    }
  | { type: 'Deselect face'; data: Selection & { type: 'face' } }
  | {
      type: 'Deselect point'
      data: Selection & { type: 'point' | 'line-end' | 'line-mid' }
    }
  | { type: 'Enter sketch' }
  | { type: 'Select all'; data: Selection & { type: 'all ' } }
  | { type: 'Select edge'; data: Selection & { type: 'edge' } }
  | { type: 'Select axis'; data: Axis }
  | { type: 'Select segment'; data: Selection & { type: 'line' | 'arc' } }
  | { type: 'Select face'; data: Selection & { type: 'face' } }
  | {
      type: 'Select default plane'
      data: { plane: DefaultPlaneStr; normal: [number, number, number] }
    }
  | { type: 'Set selection'; data: SetSelections }
  | {
      type: 'Select point'
      data: Selection & { type: 'point' | 'line-end' | 'line-mid' }
    }
  | { type: 'Sketch no face' }
  | { type: 'Toggle gui mode' }
  | { type: 'Cancel' }
  | { type: 'CancelSketch' }
  | {
      type: 'Add point'
      data: {
        coords: Models['Point2d_type'][]
        axis: 'xy' | 'xz' | 'yz' | '-xy' | '-xz' | '-yz' | null
        segmentId?: string
      }
    }
  | { type: 'Add start point' }
  | { type: 'Equip line tool'; data: Models['SceneToolType_type'] }
  | { type: 'Equip tangential arc tool'; data: Models['SceneToolType_type'] }
  | { type: 'Equip move tool' }
  | { type: 'Set radius' }
  | { type: 'Complete line' }
  | { type: 'Set distance' }
  | { type: 'Equip new tool' }
  | { type: 'update_code'; data: string }
  | { type: 'Make segment horizontal' }
  | { type: 'Make segment vertical' }
  | { type: 'Constrain horizontal distance' }
  | { type: 'Constrain ABS X' }
  | { type: 'Constrain ABS Y' }
  | { type: 'Constrain vertical distance' }
  | { type: 'Constrain angle' }
  | { type: 'Constrain perpendicular distance' }
  | { type: 'Constrain horizontally align' }
  | { type: 'Constrain vertically align' }
  | { type: 'Constrain snap to X' }
  | { type: 'Constrain snap to Y' }
  | { type: 'Constrain length' }
  | { type: 'Constrain equal length' }
  | { type: 'Constrain parallel' }
  | { type: 'Constrain remove constraints' }
  | { type: 'Re-execute' }
  | { type: 'Extrude'; data?: ModelingCommandSchema['Extrude'] }
  | { type: 'Equip Line tool 2' }
  | { type: 'Equip Line tool 3' }
  | { type: 'Equip tangential arc to 2' }
  | { type: 'Equip tangential arc to 3' }

export type MoveDesc = { line: number; snippet: string }

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogDsAFgCcAOgCswgIwBmUcIBMMgByiZwgDQgAnkNGTxS5YJoiaNUdbkBfWzrQYc+AgGUw7AASwsYcpzctAxIICxsgTyhAgiakjLi6jRySsmiqmaSojr6CHKaEmLCVqLJKqrCgvaO6Fh4UOLYEJhg7p4+fgFcuMG84RzdvDEyNBXiokqq+dI0kkr5SjmIAGzLNFIicmKl8cL51SBOdfiNza0AorjsYABOPgDWnuQAFr2h-ZFDiDKay+OCP2SclUazkYKWsUEEiUijWgmWAKykgORxcDSaLQIl2ud1gj3YLyoMhCzFYA24XwQqh+iRGkkkyy2y2Uy2yekQe1UUkmVhowmEjIUMhRtTRp0x5z47BuAFcMG9SRFBtFvkoEeJhKotZU5NJVDRJhDVutJCJKskKoY1SLnPVxG58S9iGRKJgHU9XvQ+mTPirYiCuVrTbJTZIQbMIRoEvDrDIlCIRoZhQ5DqK7e6Cc97Y7ngBJM5tFoBLwsPDsBVhH3K0AxVJh8SCEzzOP0kzmCGauTGVnLPUA2TLJQ244NDMvbMe-OYjxF7y+KAAWzAVwrH2r-EQda5jeUC1bxUEEK2EhkggyCgqMg00mHYrHWfvU9aABE4J1vKWV173lWKX7UjIRgiPC+rLBUqhKAyEJKCoxgwqyAKiAighyKst7pjmE6Zk+BCvr4s4dIuy7lt+irklENabpYgjiOYohmGqIhzDQywQlqtJZMsV6CGePzyOhJz3lhLw4ecACOMrYEwXguGAXjsKgqCYKuv4URuCA0BCNACaOmGPgW4mSdJC6oAAbnJClKSpSp-pRCDzBBDZyCx5jxvqBqRgK4hXmByTmAaEzCDpwkPjmOEeHO77dNZ5GUioLEapoJj5D8MKaBC8JKOIvZQjx1ITDGwVCfpmLICQjyEUuVxeOZNycOQJDKaRlY2Wpwz0V2SE-LIp6KIoizsrEmidfEcYIakqTLEVelhQWZUVfOVXeM8qA3NgABe3DsI1MW+nZV6muIwJgekawQbqEIjMo3lIfqzkMYF00eiFOFENwsDSiQeBeCta2bVcjVeBA2AfS6YC7eu7VbBqVjyDG1gsZI0EyGsGrpAduqAbIVQpqiGHPSVrRvbgH03F9uA1bc9WA8DoMUODzVrrZ6lXmIR0+VCkguYi0HJDRSFgVCqxIYoOM1LagkzZOBbE6T5NeAAggAQm4XgABoQ8z7W9okfJbPGSEG3I0GIUd1iVGIajFNauNppLBOzZisufd9yuqwAmprbXfEhRhnQjwIsXsh6DZMkhdijEEClzPyNmLqYS7pDvS0770uxTZBQC0XtxQaXaCFzvbMnsKODtB8bRjQcaNsyEwwk9mYvTLadk99LT4Ownoki1sX-lXNEoclrIdQaqjQcCXYqCocZTDXU224nIVN6nJPpyWtxMMuwPkDKmAkHctPbfTOd+leoyJKsmgGqsFRQtBponoOWRqpH8Lx3j9uN4TxAt-Lv0bVtRqmBdBeEatgKAPRGaqUpKzP2qE8oVFGCIS6Jg-iwj6qXdy89xYjiXt-Z2rcKa1WppgYBoCcAQJPvtQ2xg+IoSrmoJ+l1dR-DbKUKuMEYLCGRAvXBxVHZE1-t9WAuASDSQUurKhLNrB-D5PFEwKEzCMkujxLKGQES+W4Ymd+dsk5fwET-VehCfCiPEagLwnsoGtRgdYIwqhpBcTjCkU06VBpqDPDddI8YWEMQbuOfBQiKZgAkoDduUBO5SPavCYwoh7opGoioS6AoEijCvgUMMLE-GhRToIox8smD7yAdQKxvc7KpCsLrKwkFRhagqEjNxqwaJgRZPrc29IsnL1yXLb6NwwAmXMl4cggT2CwEiT7fIZtzBiB4obaQl0GQJBvgadx8x5jYITnwqW2ECwACUwAAFowB8H8DKa4Yz7LJCMBoA08x6GcJDrkLiWVYyoWuXCVCHTv6GSkvJTOxFsCA33uQeSikmrdyZt7DSWlPkGO+dJAAMngCyoKvByHOW5CQ4ckJ8hYuUNkuRNSLOchMWJEF+oIhhTkrEEkflHxgFcAFmBQE3GBRItFJS9rqRhNE2YOVVgInbINXKaN7FTF1LfEQHTEW4DkgAFVBdSoyXh+nIqshyyGiBNKDW0rwu8mFpVyoVXsw5xyd5nPVVrTV0LdX40bgarw8qlLiAAAqoDLIrCAGAIAEAVp6ksbqvzgugX6LYRg1AQXUAKXUAFLqsgSIoWYQpqSrJ4TgvVz17WOswPaMARFqq+q9T6v1n4SJBusSG7h3ktSTFhNGqusaNDjGKFitQTjIJSqRQ60FOa83eALZAH+C4mAtGuDJJF5zQ1VojbW5iMgG3xubUmttqaNnprtZ2rNPaloesLXC35+B-mApZSCtVZbSnqUneGmtUbZ3zqbYmjQybnEdplV2p1Hhe07oHXu2SJ6wXenLXZS91bI2MlvQ0xtCaW1PvbTaz+45M3dtzLgDgBAJ2VqvaButc6IMLofa2lNL7DVOuQ6hokZ7OUxGA9Om9MbcP3ug8uojb7s0ADlzGurLLAItEB-VlnQ2GkDM66O5BRpBxdj6mNwb0eONAAys1tEirOaKFrIXcNYoNfZaguwro-jJrMcniOYAIMao5JzzUUY1QgdTEJ9nNikB0wzLHFU-N-ZZf9P5APqS1bkHVabbWybMkZlz4i-kMqPay0F5ykK0SyFjfU9iVDGzcZPNUoYzz0jEOKxzQWWPiCc3gMjqnKSoXmMYWQ+VUKWAUA874YJ1jNssOYUEwIdGLyEk5zdBWUPsDQ8SAD56qODknhVq8VW0i1diJMLKjXqItYyDl+T3butkaUJZy1eRhvldbbEtYE3mHsVm81oEC3pNLwVgAdy+stVaACAZMsPmDLweAABmqACAQG4GARouBTKoEeOIGA7B9n-3+ttTA+zXuoHRekYQtIUhyHhHyJCexkZjBhPSNQLFI7tLO0JS712fq3bBzTEGR9KDPdwG9ggtwbirXEMOkg7A3s3AXIDzwIPieAIh1DmH9iNRPomCMeMCJkZeU7Bjkw8RRAdIJxwSmdVsANQe2Tp7UOPtfZ+39gHQP9nEKV41SHVPofFf-NYLKXMo3nXKLzTU7MoTmkgmsZM-n4NZjl94fXyugaq-ppT6ntP6eM+Z6tNnuuveG956bspNhvKNjDGYYoEFGy8wSmdblPIAQAll1d+Xbt1b+-e59mVWv-vfd1yQAARrAfZfAjdvZh-RbykwpgMPsaL0ONcpBTD4s43lOfCf57VoXmnNw6c3AZ3vEPrP2fA6rzXuvUf1uQphE39yAI4j0guqHXyut5CVGsFn1QA+88qwsSP4v328Da-Lxz+f+zdD15N8vuKMiGwwTDIjxQqFALQR702lGbhSoPUOwPHTCD3RWM-d2EfQPCfYPFnMPO-avB-J-RvGiBQfkXseQeQSYDTXIGESYKQJxFxTkaiE-bwTOFoC-TXa-MvWffZSgg5JfAbSjTcQ-bKBEJCBYLLMeUOFIBIRHfIbFTUblcg0BfAKg9XWAyfJnBA+gxg1A6PLlawCQfyQwLIUVM8Xg-AyYBIekQcLA5QQwdZPTc7XPbwMJTuagkvWgnXDnSw54RQl-M3QwBsc3GCNINQdIaCfkTFFyOMSCWQWQUA13fTcQCAhwmAsfIPKfOQ3XBwpwlgqzVfP4AUAEcMMEbhWJHw8wbyWYK2VCCCWYMQzeG4TeXAbeXefeH3OmCndXS-UvOw4HUo8oyoveG4fZR7emRIzzQbNgvYI6SCQCEwdRHse+dQWkAcAoA6AUEojeLeJXKog+X3Oo43UfcfGQ6fRA5o+YioxY9ozolYpg43GHAY5xYYzUeEMY0OaQBIakKYy2QwWYsAjNTtdzVFRTDoZTIIJQmIJPGiKYeiXsEwUWVxAlFIcrZ3ekWYehNrTZV419d4uQELfdelTgCLEFVFCdeJDUeIPOekWMDKRHEVT-cVSoSVF49dRElFLsUjXrCdU8OHaZKNfkS8XsHwq5G5FhZkO6FGZjJE8QOkvrZwoDPkIwLIMEH4RkeMGzQaLYLkTUM6fIXsc0Aufkmk8QXAUPRqT4-CfwSIdDZkJyZ+SCfQ9khpP4OYbhFQUaLibhdUpSVFcQdjLwTjK4bjAtHwbaOqPjQNJIjbUrQoWQKueIVYGrbQOUryNZFiakMwM8fkDpIU85MTaERkQ-EYFiECSMI0n4DIGU2xKuEI1dALLMJM-rXo1gyEaGYWK8ZNEQQWS6G5DUVCfkAuHKFKDpWVMLdEplIFTE5EiKL4-UlTEUi9EEBILLHA7hAEGENiDII6WYQwfuG03HUIpeLsg9cLXs49NlFE+1JEidePIgvkIAuueiepXIQeDUcpbGcOOMfiSkl4LwLUrwF7EgSgQsfUoGMAN83eD8PeGVZMxHJpW5VkaQLcAacE-OLmMlKYXsW4nhFMLUjAeAUIPTf0yFfZJCWzekGiLmSwCaIXFQGXM7DEMADCykCoOHMaLmdIBiFUo0KYKQWisEDQO000LJCiv0fZTUWzc0WiJreQAi2BSlbZFoLispUYLKPWEYOOdySCxAOuBscCORZpAg5jLNCS5QmiTDYTetBpPkDUZtAcdIFs3TXRJeRDJ1Z8L7LSqjDDITWjfS0TM8fmCTAjZ9R8rMKy7NN0vtT1SAOyxAaja9MDETH2EwBjZyMQakQcY-Ly8QHyrdYiL9CAIKvIBymjMK5yqiLIIy2YORDQaeIs0woSJKuk9KkKrDcDfAsbe9GK2JLIkqiysqjdbtF0vy1CsiSsqqvSnDfAlIBU4oLLU0XKcy9rTCTrUFSqlhDg15PYPbGrS6TQfmZHCwQeUoZqia56Kap1FbdgSq4aua1kBa6reiaCRkHS9QfULmSYN+eKtcjrXLLrXLC7DgFaU5LwXpE1czciisqzLYQysMk68bJazvAEbKa6gqu6hEB64st3fLZ65bV696rwMzM1P67qgGo64G7-Ra860OQwCOKG269RM8RbIzZ08xFVQ6oGxkEG-GybfIaskm0ee6sQ0HbnGo8nOSKHdKwIwMcwUCUaguSbG0v4Vy2xBZOEtdccCAiPFXWo3m43fmhkC3NUS8YoaubQqiTQDUG+eEcVeidIMQofQvVWlCIy2xRseMGpC61w9QRQfUUocCNUhKiA-PaAvm-6jbSCRsRIK0TiONDIP-GEDgiCK0oq00Ewlq8A8w8QrOZWt7C2q5W6GcsDQA8uS2tUeCgqywOYGWks8I+OyI72rG3200dYHiNIQovYcOPAzcLW4wJkCO9I+xca+ExuCAlohYnedo7mtXFWn2lfcOHSwUUrYeS3e+LyFGU04aiCWDR6-VN4mk-mpCdAxiDIOYThC8lYWiKXPWc3NYWGh0plWknrSqkMwY2GguThSCC6v4RHLURHNsTUMMIKBK-cjUrU1nRqQ66wI6fWfILI68CMnQx+a+ZkYi9TD+pehE1VM+qm10gNEZSqpLYwaQU0YEU8SwAm3IJkZuuEYqliXsRMi+4emBehcYBLexTUUwSMZIJyZsGCWhh+Ts7sxlZlSLVFQ6vW1yOKrgv2tiCEgUJsMMWxaKrJZ88xN8ygdKkYHWAULUVkeUzkBu6zeMa86beLRpHGewIAA */
    id: 'Modeling',

    tsTypes: {} as import('./modelingMachine.typegen').Typegen0,
    predictableActionArguments: true,
    preserveActionOrder: true,

    context: {
      guiMode: 'default',
      tool: null as Models['SceneToolType_type'] | null,
      selection: [] as string[],
      selectionRanges: {
        otherSelections: [],
        codeBasedSelections: [],
      } as Selections,
      selectionRangeTypeMap: {} as SelectionRangeTypeMap,
      sketchPathToNode: null as PathToNode | null, // maybe too specific, and we should have a generic pathToNode, but being specific seems less risky when I'm not sure
      sketchEnginePathId: '' as string,
      sketchPlaneId: '' as string,
      sketchNormalBackUp: null as null | [number, number, number],
      moveDescs: [] as MoveDesc[],
    },

    schema: {
      events: {} as ModelingMachineEvent,
    },

    states: {
      idle: {
        on: {
          'Set selection': {
            target: 'idle',
            internal: true,
            actions: 'Set selection',
          },

          'Enter sketch': [
            {
              target: 'Sketch',
              cond: 'Selection is one face',
              actions: ['set sketch metadata'],
            },
            'Sketch no face',
          ],

          Extrude: {
            target: 'idle',
            cond: 'has valid extrude selection',
            actions: ['AST extrude'],
            internal: true,
          },
        },
      },

      Sketch: {
        states: {
          SketchIdle: {
            on: {
              'Select point': {
                target: 'SketchIdle',
                internal: true,
                actions: [
                  'Update code selection cursors',
                  'Add to code-based selection',
                ],
              },

              'Select segment': {
                target: 'SketchIdle',
                internal: true,
                actions: [
                  'Update code selection cursors',
                  'Add to code-based selection',
                ],
              },

              'Deselect point': {
                target: 'SketchIdle',
                internal: true,
                cond: 'Selection contains point',
                actions: [
                  'Update code selection cursors',
                  'Add to code-based selection',
                ],
              },

              'Deselect segment': {
                target: 'SketchIdle',
                internal: true,
                cond: 'Selection contains line',
                actions: [
                  'Update code selection cursors',
                  'Add to code-based selection',
                ],
              },

              'Set selection': {
                target: 'SketchIdle',
                internal: true,
                actions: 'Set selection',
              },

              'Make segment vertical': {
                cond: 'Can make selection vertical',
                target: 'SketchIdle',
                internal: true,
                actions: ['Make selection vertical'],
              },

              'Make segment horizontal': {
                target: 'SketchIdle',
                internal: true,
                cond: 'Can make selection horizontal',
                actions: ['Make selection horizontal'],
              },

              'Constrain horizontal distance': {
                target: 'Await horizontal distance info',
                cond: 'Can constrain horizontal distance',
              },

              'Constrain vertical distance': {
                target: 'Await vertical distance info',
                cond: 'Can constrain vertical distance',
              },

              'Constrain ABS X': {
                target: 'Await ABS X info',
                cond: 'Can constrain ABS X',
              },

              'Constrain ABS Y': {
                target: 'Await ABS Y info',
                cond: 'Can constrain ABS Y',
              },

              'Constrain angle': {
                target: 'Await angle info',
                cond: 'Can constrain angle',
              },

              'Constrain length': {
                target: 'Await length info',
                cond: 'Can constrain length',
              },

              'Constrain perpendicular distance': {
                target: 'Await perpendicular distance info',
                cond: 'Can constrain perpendicular distance',
              },

              'Constrain horizontally align': {
                cond: 'Can constrain horizontally align',
                target: 'SketchIdle',
                internal: true,
                actions: ['Constrain horizontally align'],
              },

              'Constrain vertically align': {
                cond: 'Can constrain vertically align',
                target: 'SketchIdle',
                internal: true,
                actions: ['Constrain vertically align'],
              },

              'Constrain snap to X': {
                cond: 'Can constrain snap to X',
                target: 'SketchIdle',
                internal: true,
                actions: ['Constrain snap to X'],
              },

              'Constrain snap to Y': {
                cond: 'Can constrain snap to Y',
                target: 'SketchIdle',
                internal: true,
                actions: ['Constrain snap to Y'],
              },

              'Constrain equal length': {
                cond: 'Can constrain equal length',
                target: 'SketchIdle',
                internal: true,
                actions: ['Constrain equal length'],
              },

              'Constrain parallel': {
                target: 'SketchIdle',
                internal: true,
                cond: 'Can canstrain parallel',
                actions: ['Constrain parallel'],
              },

              'Constrain remove constraints': {
                target: 'SketchIdle',
                internal: true,
                cond: 'Can constrain remove constraints',
                actions: ['Constrain remove constraints'],
              },

              'Re-execute': {
                target: 'SketchIdle',
                internal: true,
                actions: [
                  'set sketchMetadata from pathToNode',
                  'sketch mode enabled',
                  'edit mode enter',
                ],
              },

              'Equip Line tool 3': 'Line tool 3',

              'Equip tangential arc to 3': {
                target: 'Tangential arc to 3',
                cond: 'is editing existing sketch',
              },
            },

            entry: ['equip select'],
          },

          'Await horizontal distance info': {
            invoke: {
              src: 'Get horizontal info',
              id: 'get-horizontal-info',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
              onError: 'SketchIdle',
            },
          },

          'Await vertical distance info': {
            invoke: {
              src: 'Get vertical info',
              id: 'get-vertical-info',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
              onError: 'SketchIdle',
            },
          },

          'Await ABS X info': {
            invoke: {
              src: 'Get ABS X info',
              id: 'get-abs-x-info',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
              onError: 'SketchIdle',
            },
          },

          'Await ABS Y info': {
            invoke: {
              src: 'Get ABS Y info',
              id: 'get-abs-y-info',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
              onError: 'SketchIdle',
            },
          },

          'Await angle info': {
            invoke: {
              src: 'Get angle info',
              id: 'get-angle-info',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
              onError: 'SketchIdle',
            },
          },

          'Await length info': {
            invoke: {
              src: 'Get length info',
              id: 'get-length-info',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
              onError: 'SketchIdle',
            },
          },

          'Await perpendicular distance info': {
            invoke: {
              src: 'Get perpendicular distance info',
              id: 'get-perpendicular-distance-info',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
              onError: 'SketchIdle',
            },
          },

          'Line tool 3': {
            exit: [
              'tear down client sketch',
              'setup client side sketch segments',
            ],

            on: {
              'Set selection': {
                target: 'Line tool 3',
                description: `This is just here to stop one of the higher level "Set selections" firing when we are just trying to set the IDE code without triggering a full engine-execute`,
                internal: true,
              },

              'Equip tangential arc to 3': {
                target: 'Tangential arc to 3',
                cond: 'is editing existing sketch',
              },
            },

            states: {
              Init: {
                always: [
                  {
                    target: 'normal',
                    cond: 'is editing existing sketch',
                    actions: 'set up draft line 2',
                  },
                  'No Points',
                ],
              },

              normal: {
                on: {
                  'Set selection': {
                    target: 'normal',
                    internal: true,
                  },
                },
              },

              'No Points': {
                entry: 'setup noPoints onClick listener',

                on: {
                  'Add start point': {
                    target: 'normal',
                    actions: 'set up draft line without teardown',
                  },
                },
              },
            },

            initial: 'Init',
          },

          Init: {
            always: [
              {
                target: 'SketchIdle',
                cond: 'is editing existing sketch',
              },
              'Line tool 3',
            ],
          },

          'Tangential arc to 3': {
            exit: [
              'tear down client sketch',
              'setup client side sketch segments',
            ],

            entry: 'set up draft arc 2',

            on: {
              'Set selection': {
                target: 'Tangential arc to 3',
                internal: true,
              },

              'Equip Line tool 3': 'Line tool 3',
            },
          },
        },

        initial: 'Init',

        on: {
          CancelSketch: '.SketchIdle',
        },

        exit: [
          'sketch exit execute',
          'animate after sketch',
          'tear down client sketch',
        ],

        entry: [
          'setup client side sketch segments',
          'setup client side sketch camera',
        ],
      },

      'Sketch no face': {
        entry: 'show default planes',

        exit: 'hide default planes',
        on: {
          'Select default plane': {
            target: 'Sketch.SketchIdle',
            actions: [
              'reset sketch metadata',
              'AST startSketchOn default plane',
            ],
          },
        },
      },
    },

    initial: 'idle',

    on: {
      Cancel: {
        target: 'idle',
        // TODO what if we're existing extrude equipped, should these actions still be fired?
        // maybe cancel needs to have a guard for if else logic?
        actions: [
          'edit_mode_exit',
          'default_camera_disable_sketch_mode',
          'reset sketch metadata',
        ],
      },

      'Set selection': {
        target: '#Modeling',
        internal: true,
        actions: 'Set selection',
      },
    },
  },
  {
    guards: {
      'is editing existing sketch': ({ sketchPathToNode }) => {
        // should check that the variable declaration is a pipeExpression
        // and that the pipeExpression contains a "startProfileAt" callExpression
        if (!sketchPathToNode) return false
        const variableDeclaration = getNodeFromPath<VariableDeclarator>(
          kclManager.ast,
          sketchPathToNode,
          'VariableDeclarator'
        ).node
        if (variableDeclaration.type !== 'VariableDeclarator') return false
        const pipeExpression = variableDeclaration.init
        if (pipeExpression.type !== 'PipeExpression') return false
        const hasStartProfileAt = pipeExpression.body.some(
          (item) =>
            item.type === 'CallExpression' &&
            item.callee.name === 'startProfileAt'
        )
        return hasStartProfileAt && pipeExpression.body.length > 2
      },
      'Can make selection horizontal': ({ selectionRanges }) =>
        horzVertInfo(selectionRanges, 'horizontal').enabled,
      'Can make selection vertical': ({ selectionRanges }) =>
        horzVertInfo(selectionRanges, 'vertical').enabled,
      'Can constrain horizontal distance': ({ selectionRanges }) =>
        horzVertDistanceInfo({ selectionRanges, constraint: 'setHorzDistance' })
          .enabled,
      'Can constrain vertical distance': ({ selectionRanges }) =>
        horzVertDistanceInfo({ selectionRanges, constraint: 'setVertDistance' })
          .enabled,
      'Can constrain ABS X': ({ selectionRanges }) =>
        absDistanceInfo({ selectionRanges, constraint: 'xAbs' }).enabled,
      'Can constrain ABS Y': ({ selectionRanges }) =>
        absDistanceInfo({ selectionRanges, constraint: 'yAbs' }).enabled,
      'Can constrain angle': ({ selectionRanges }) =>
        angleBetweenInfo({ selectionRanges }).enabled ||
        angleLengthInfo({ selectionRanges, angleOrLength: 'setAngle' }).enabled,
      'Can constrain length': ({ selectionRanges }) =>
        angleLengthInfo({ selectionRanges }).enabled,
      'Can constrain perpendicular distance': ({ selectionRanges }) =>
        intersectInfo({ selectionRanges }).enabled,
      'Can constrain horizontally align': ({ selectionRanges }) =>
        horzVertDistanceInfo({ selectionRanges, constraint: 'setHorzDistance' })
          .enabled,
      'Can constrain vertically align': ({ selectionRanges }) =>
        horzVertDistanceInfo({ selectionRanges, constraint: 'setHorzDistance' })
          .enabled,
      'Can constrain snap to X': ({ selectionRanges }) =>
        absDistanceInfo({ selectionRanges, constraint: 'snapToXAxis' }).enabled,
      'Can constrain snap to Y': ({ selectionRanges }) =>
        absDistanceInfo({ selectionRanges, constraint: 'snapToYAxis' }).enabled,
      'Can constrain equal length': ({ selectionRanges }) =>
        setEqualLengthInfo({ selectionRanges }).enabled,
      'Can canstrain parallel': ({ selectionRanges }) =>
        equalAngleInfo({ selectionRanges }).enabled,
      'Can constrain remove constraints': ({ selectionRanges }) =>
        removeConstrainingValuesInfo({ selectionRanges }).enabled,
    },
    // end guards
    actions: {
      'Add to code-based selection': assign({
        selectionRanges: ({ selectionRanges }, event) => ({
          ...selectionRanges,
          codeBasedSelections: [
            ...selectionRanges.codeBasedSelections,
            event.data,
          ],
        }),
      }),

      'sketch mode enabled': ({ sketchPlaneId }) => {
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'sketch_mode_enable',
            plane_id: sketchPlaneId,
            ortho: true,
            animated: !isReducedMotion(),
          },
        })
      },
      'set sketchMetadata from pathToNode': assign(({ sketchPathToNode }) => {
        if (!sketchPathToNode) return {}
        return getSketchMetadataFromPathToNode(sketchPathToNode)
      }),
      'edit mode enter': ({ selectionRanges }) => {
        const pathId = isCursorInSketchCommandRange(
          engineCommandManager.artifactMap,
          selectionRanges
        )
        pathId &&
          engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: {
              type: 'edit_mode_enter',
              target: pathId,
            },
          })
      },
      'hide default planes': () => setupSingleton.removeDefaultPlanes(),
      edit_mode_exit: () =>
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: { type: 'edit_mode_exit' },
        }),
      default_camera_disable_sketch_mode: () =>
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: { type: 'default_camera_disable_sketch_mode' },
        }),
      'reset sketch metadata': assign({
        sketchPathToNode: null,
        sketchEnginePathId: '',
        sketchPlaneId: '',
      }),
      'set sketch metadata': assign(({ selectionRanges }) => {
        const sourceRange = selectionRanges.codeBasedSelections[0].range
        const sketchPathToNode = getNodePathFromSourceRange(
          kclManager.ast,
          sourceRange
        )
        return getSketchMetadataFromPathToNode(
          sketchPathToNode,
          selectionRanges
        )
      }),
      'equip select': () =>
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'set_tool',
            tool: 'select',
          },
        }),
      // TODO implement source ranges for all of these constraints
      // need to make the async like the modal constraints
      'Make selection horizontal': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintHorzVert(
          selectionRanges,
          'horizontal',
          kclManager.ast,
          kclManager.programMemory
        )
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Make selection vertical': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintHorzVert(
          selectionRanges,
          'vertical',
          kclManager.ast,
          kclManager.programMemory
        )
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain horizontally align': ({
        selectionRanges,
        sketchPathToNode,
      }) => {
        const { modifiedAst } = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setVertDistance',
        })
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain vertically align': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setHorzDistance',
        })
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain snap to X': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintAxisAlign({
          selectionRanges,
          constraint: 'snapToXAxis',
        })
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain snap to Y': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintAxisAlign({
          selectionRanges,
          constraint: 'snapToYAxis',
        })
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain equal length': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintEqualLength({
          selectionRanges,
        })
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain parallel': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintEqualAngle({
          selectionRanges,
        })
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain remove constraints': ({
        selectionRanges,
        sketchPathToNode,
      }) => {
        const { modifiedAst } = applyRemoveConstrainingValues({
          selectionRanges,
        })
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'AST extrude': (_, event) => {
        if (!event.data) return
        const { selection, distance } = event.data
        const pathToNode = getNodePathFromSourceRange(
          kclManager.ast,
          selection.codeBasedSelections[0].range
        )
        const { modifiedAst, pathToExtrudeArg } = extrudeSketch(
          kclManager.ast,
          pathToNode,
          true,
          distance
        )
        // TODO not handling focusPath correctly I think
        kclManager.updateAst(modifiedAst, true, {
          focusPath: pathToExtrudeArg,
        })
      },
      'setup client side sketch camera': ({
        sketchPathToNode,
        sketchNormalBackUp,
      }) => {
        const variableDeclarationName =
          getNodeFromPath<VariableDeclaration>(
            kclManager.ast,
            sketchPathToNode || [],
            'VariableDeclaration'
          )?.node?.declarations?.[0]?.id?.name || ''
        const sketchQuaternion = kclManager.programMemory.root[
          variableDeclarationName
        ] as SketchGroup

        const zAxis = sketchQuaternion?.zAxis || sketchNormalBackUp

        const dummyCam = new PerspectiveCamera()
        dummyCam.up.set(0, 0, 1)
        dummyCam.position.set(
          ...(sketchQuaternion?.zAxis || sketchNormalBackUp)
        )
        dummyCam.lookAt(0, 0, 0)
        dummyCam.updateMatrix()
        const quaternion = dummyCam.quaternion.clone()

        const isVert = isQuaternionVertical(quaternion)

        // because vertical quaternions are a gimbal lock, for the orbit controls
        // it's best to set them explicitly to the vertical position with a known good camera up
        if (isVert && zAxis[2] < 0) {
          quaternion.set(0, 1, 0, 0)
        } else if (isVert) {
          quaternion.set(0, 0, 0, 1)
        }

        setupSingleton.tweenCameraToQuaternion(quaternion)
      },
      'setup client side sketch segments': ({ sketchPathToNode }, { type }) => {
        if (type !== 'Select default plane') {
          clientSideScene.setupSketch({
            sketchPathToNode: sketchPathToNode || [],
          })
        } else {
          setupSingleton.modelingSend('Equip Line tool 3')
        }
      },
      'animate after sketch': () => {
        clientSideScene.animateAfterSketch()
      },
      'tear down client sketch': () => {
        clientSideScene.tearDownSketch()
      },
      'set up draft line 2': ({ sketchPathToNode }) => {
        clientSideScene.setUpDraftLine(sketchPathToNode || [])
      },
      'set up draft arc 2': ({ sketchPathToNode }) => {
        clientSideScene.setUpDraftArc(sketchPathToNode || [])
      },
      'set up draft line without teardown': ({ sketchPathToNode }) =>
        clientSideScene.setupSketch({
          sketchPathToNode: sketchPathToNode || [],
          draftSegment: 'line',
        }),
      'show default planes': () => {
        setupSingleton.showDefaultPlanes()
        clientSideScene.setupDefaultPlaneHover()
      },
      'AST startSketchOn default plane': assign(
        (_, { data: { plane, normal } }) => {
          const { modifiedAst, pathToNode } = startSketchOnDefault(
            kclManager.ast,
            plane
          )
          kclManager.updateAst(modifiedAst, false)
          return {
            sketchPathToNode: pathToNode,
            sketchNormalBackUp: normal,
          }
        }
      ),
      'setup noPoints onClick listener': ({ sketchPathToNode }) => {
        clientSideScene.createIntersectionPlane()
        setTimeout(() => {
          // TODO this time out is needed because 'kclManager.updateAst(modifiedAst, false)' in 'AST startSketchOn default plane'
          // is async and we need time for the ast to have updated.
          // it's very annoying that you can't have async actions in xstate and have to invoke things and have all this extra
          // cruft in the diagram just to handle the occasional wait
          const varDec = getNodeFromPath<VariableDeclarator>(
            kclManager.ast,
            sketchPathToNode || [],
            'VariableDeclarator'
          ).node
          const sketchGroup = kclManager.programMemory.root[
            varDec.id.name
          ] as SketchGroup
          const quaternion = quaternionFromSketchGroup(sketchGroup)
          clientSideScene.intersectionPlane &&
            clientSideScene.intersectionPlane.setRotationFromQuaternion(
              quaternion
            )

          setupSingleton.setCallbacks({
            onClick: async (args) => {
              if (!args) return
              const { intersection2d } = args
              if (!intersection2d || !sketchPathToNode) return
              const { modifiedAst } = addStartProfileAt(
                kclManager.ast,
                sketchPathToNode,
                [intersection2d.x, intersection2d.y]
              )
              await kclManager.updateAst(modifiedAst, false)
              clientSideScene.removeIntersectionPlane()
              setupSingleton.modelingSend('Add start point')
            },
          })
        }, 200)
      },
    },
    // end actions
  }
)

function getSketchMetadataFromPathToNode(
  pathToNode: PathToNode,
  selectionRanges?: Selections
) {
  const pipeExpression = getNodeFromPath<PipeExpression>(
    kclManager.ast,
    pathToNode,
    'PipeExpression'
  ).node
  if (pipeExpression.type !== 'PipeExpression') return {}
  const sketchCallExpression = pipeExpression.body.find(
    (e) => e.type === 'CallExpression' && e.callee.name === 'startSketchOn'
  ) as CallExpression
  if (!sketchCallExpression) return {}

  let sketchEnginePathId: string
  if (selectionRanges) {
    sketchEnginePathId =
      isCursorInSketchCommandRange(
        engineCommandManager.artifactMap,
        selectionRanges
      ) || ''
  } else {
    const _selectionRanges: Selections = {
      otherSelections: [],
      codeBasedSelections: [
        { range: [pipeExpression.start, pipeExpression.end], type: 'default' },
      ],
    }
    sketchEnginePathId =
      isCursorInSketchCommandRange(
        engineCommandManager.artifactMap,
        _selectionRanges
      ) || ''
  }
  return {
    sketchPathToNode: pathToNode,
    sketchEnginePathId,
  }
}
