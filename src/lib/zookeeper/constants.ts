/** Warn above 64 MiB to discourage slow Zookeeper requests; uploads are still allowed. */
export const ZOOKEEPER_PROJECT_SIZE_WARNING_BYTES = 64 * 1024 * 1024
