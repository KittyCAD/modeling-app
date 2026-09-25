// Generated from KittyCAD/api#4696. Do not edit by hand.
export type paths = Record<string, never>
export type webhooks = Record<string, never>
export interface components {
  schemas: {
    /** @description The restricted public migration connection never accepts ordinary prompts. */
    KclMigrationClientMessage:
      | {
          headers: {
            [key: string]: string
          }
          /** @enum {string} */
          type: 'headers'
        }
      | {
          request: components['schemas']['KclMigrationRequest']
          /** @enum {string} */
          type: 'start'
        }
      | {
          operation_id: components['schemas']['Uuid']
          /** @enum {string} */
          type: 'status'
        }
      | {
          operation_id: components['schemas']['Uuid']
          /** @enum {string} */
          type: 'cancel'
        }
      | {
          /** @enum {string} */
          type: 'ping'
        }
    /** @description A complete, immutable input snapshot. It does not grant sponsorship itself. */
    KclMigrationRequest: {
      /**
       * @description Explicit consent to unstable preview semantics.
       * @default false
       */
      allow_preview?: boolean
      /** @description Complete project, including unsaved edits, imports, and settings. */
      current_files: {
        [key: string]: number[]
      }
      /** @description Project-relative KCL file to execute. */
      entrypoint: string
      /** @description Revision against which the user will review and apply the candidate. */
      project_snapshot: components['schemas']['MlCopilotProjectSnapshotMetadata']
      /** @description Client-generated idempotency key. Reuse it when retrying delivery. */
      request_id: components['schemas']['Uuid']
      /** @description Requested target. The worker inspects the actual source version. */
      target: components['schemas']['KclMigrationTarget']
    }
    /** @description Revision metadata for the complete `current_files` map in a client message. */
    MlCopilotProjectSnapshotMetadata: {
      /** @description Canonical revision and writer fence on which `current_files` is based. Its `project_id` must match the outer `project_id`. Omit this only when establishing the first canonical revision; omission must not replace an existing revision. */
      base_revision?: components['schemas']['MlCopilotProjectRevision'] | null
      /** @description Stable, namespaced project identifier. Cloud projects use `cloud:<project UUID>` and API validates project access. Local projects use `local:<durable app project ID>` and API scopes the value to the authenticated principal. */
      project_id: string
      /** @description Idempotency key for this complete project snapshot, scoped to `project_id`. */
      snapshot_id: string
    }
    /** @description Canonical project revision accepted by API. */
    MlCopilotProjectRevision: {
      /** @description Stable namespaced project identifier shared by every revision of the project. */
      project_id: string
      /** @description Opaque identifier for the accepted project state. Every accepted write gets a fresh value, even when its contents equal an older revision. Clients must not infer file equality or ancestry from this value. */
      revision: string
      /** @description Opaque API-issued token that must accompany subsequent writes to this revision. */
      writer_fence: string
    }
    /**
     * Format: uuid
     * @description A UUID usually v4 or v7
     */
    Uuid: string
    /** @description A supported migration target. Preview use always requires explicit consent. */
    KclMigrationTarget: '3.0-preview' | '3.0'
    /** @description Public responses never contain ordinary auto-applying tool results. */
    KclMigrationServerMessage:
      | {
          operation: components['schemas']['KclMigrationOperation']
          /** @enum {string} */
          type: 'operation'
        }
      | {
          detail: string
          /** @enum {string} */
          type: 'error'
        }
      | {
          /** @enum {string} */
          type: 'pong'
        }
    /** @description Persisted operation state, safe to retrieve again without starting new work. */
    KclMigrationOperation: {
      /**
       * Format: date-time
       * @description Original deadline, including preparation and validation. Never extended.
       */
      deadline: string
      /** @description Same idempotency key supplied by the initiating client. */
      id: components['schemas']['Uuid']
      /** @description Source revision, retained for conflict detection when applying the result. */
      project_snapshot: components['schemas']['MlCopilotProjectSnapshotMetadata']
      /** @description Terminal result, if available. The review itself has no execution deadline. */
      result?: components['schemas']['KclMigrationResult'] | null
      /** @description Current state. */
      status: components['schemas']['KclMigrationStatus']
      /** @description Target accepted for this attempt. */
      target: components['schemas']['KclMigrationTarget']
    }
    /** @description A worker's terminal candidate, held separately from ordinary project edits. */
    KclMigrationResult: {
      /**
       * @description Confirmed rejection or failure before conversion started. Only unsuccessful attempts may set this; API excludes them from the daily attempt allowance. Missing evidence defaults to counting the attempt.
       * @default false
       */
      conversion_not_started?: boolean
      /** @description User-facing outcome or failure explanation. */
      detail: string
      /**
       * @description Candidate project, returned only after successful validation.
       * @default {}
       */
      files?: {
        [key: string]: number[]
      }
      /** @description Terminal state. `running` is not a valid result. */
      status: components['schemas']['KclMigrationStatus']
      /** @description Execution and equivalence evidence, required on success. */
      validation?: components['schemas']['KclMigrationValidation'] | null
    }
    /** @description Durable state of a migration attempt. */
    KclMigrationStatus:
      | 'running'
      | 'succeeded'
      | 'failed'
      | 'timed_out'
      | 'cancelled'
      | 'unsupported'
      | 'validation_failed'
    /** @description Evidence required before a candidate may be returned as successful. */
    KclMigrationValidation: {
      /** @description Relevant parameter and control-flow behavior passed validation. */
      behavior_preserved: boolean
      /** @description Geometry passed the version-pair validation policy. */
      geometry_preserved: boolean
      /** @description Revision of the conversion instructions and validation policy. */
      rules_revision: string
      /** @description Exact target runtime used for execution and geometry checks. */
      runtime_version: string
      /** @description The unchanged source project executed successfully. */
      source_executed: boolean
      /** @description Actual source semantics detected and executed by the worker. */
      source_version: string
      /** @description Reviewable explanation of checks, tolerances, and any accepted differences. */
      summary: string
      /** @description Target semantics used during validation, which must match the request. */
      target: components['schemas']['KclMigrationTarget']
      /** @description The candidate executed successfully under target semantics. */
      target_executed: boolean
    }
  }
  responses: never
  parameters: never
  requestBodies: never
  headers: never
  pathItems: never
}
export type $defs = Record<string, never>
export type operations = Record<string, never>
