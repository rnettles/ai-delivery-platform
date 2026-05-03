/**
 * Feature flags. Read once per process from environment variables.
 *
 * Conventions:
 *  - Truthy values: "true", "1", "yes", "on" (case-insensitive)
 *  - Anything else (including unset) is falsy
 *  - Flags are read lazily at call time so tests can mutate `process.env`
 */

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const featureFlags: Record<string, never> = {};
