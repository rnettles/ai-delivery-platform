/**
 * Feature flags. Read once per process from environment variables.
 *
 * Conventions:
 *  - Truthy values: "true", "1", "yes", "on" (case-insensitive)
 *  - Anything else (including unset) is falsy
 *  - Flags are read lazily at call time so tests can mutate `process.env`
 */

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
}

export const featureFlags = {
  /**
   * SPRINT_PLAN_RICH — when enabled, the Sprint Planner emits the rich Plan v1
   * shape (with per-task execution_contract) and the deterministic markdown renderer
   * is used. When disabled (default) the legacy thin sprint plan path is used.
   */
  sprintPlanRich(): boolean {
    return isTruthy(process.env.SPRINT_PLAN_RICH);
  },
};
