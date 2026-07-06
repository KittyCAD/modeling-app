/** Base class for registry-specific errors. */
export class RegistryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

/** Thrown when a singleton service has more than one provider. */
export class ServiceConflictError extends RegistryError {}

/** Thrown when a required service cannot be resolved. */
export class MissingServiceError extends RegistryError {}

/** Thrown when service resolution happens at an invalid time or recursively. */
export class ServiceResolutionError extends RegistryError {}

/** Thrown when value-spec combine logic attempts to call service methods. */
export class CombineMutationError extends RegistryError {}

/** Thrown when registry graph reconfiguration happens at an invalid time. */
export class ReconfigurationError extends RegistryError {}
