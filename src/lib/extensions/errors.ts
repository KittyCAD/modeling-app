/** Base class for framework-specific errors. */
export class ExtensionFrameworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

/** Thrown when a singleton service has more than one provider. */
export class ServiceConflictError extends ExtensionFrameworkError {}

/** Thrown when a required service cannot be resolved. */
export class MissingServiceError extends ExtensionFrameworkError {}

/** Thrown when service resolution happens at an invalid time or recursively. */
export class ServiceResolutionError extends ExtensionFrameworkError {}

/** Thrown when facet combine logic attempts to call service methods. */
export class CombineMutationError extends ExtensionFrameworkError {}
