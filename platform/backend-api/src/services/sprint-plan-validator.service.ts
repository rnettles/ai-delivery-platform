import Ajv, { ErrorObject, ValidateFunction } from "ajv";
import { governanceService } from "./governance.service";
import { logger } from "./logger.service";
import type { RichSprintLlmResponse } from "../domain/sprint-plan.types";
import type { ExecutionContract } from "../domain/execution-contract.types";

/**
 * AJV-based validator for the rich Sprint Plan and Execution Contract schemas.
 *
 * Loads both governance schemas at first use and registers them with their
 * `$id` so cross-schema `$ref` (sprint_plan_rich -> execution_contract) resolves.
 *
 * Used by:
 *  • Sprint Planner LLM call to validate the rich JSON response before persistence
 *  • Sprint Controller staging to validate the staged plan before deterministic emit
 *  • Implementer/Verifier to validate execution_contract parsed out of the brief
 */
export class SprintPlanValidatorService {
  private ajv: Ajv | null = null;
  private validateRichPlan: ValidateFunction | null = null;
  private validateExecutionContract: ValidateFunction | null = null;

  private async ensureCompiled(): Promise<void> {
    if (this.ajv && this.validateRichPlan && this.validateExecutionContract) return;

    const ajv = new Ajv({ allErrors: true, strict: false });

    const [richPlanSchema, executionContractSchema] = await Promise.all([
      governanceService.getSchema("sprint_plan_rich") as Promise<Record<string, unknown>>,
      governanceService.getSchema("execution_contract") as Promise<Record<string, unknown>>,
    ]);

    // Register the execution_contract schema first so the rich plan's $ref resolves.
    ajv.addSchema(executionContractSchema, "execution_contract.schema.json");
    ajv.addSchema(richPlanSchema, "sprint_plan_rich.schema.json");

    this.ajv = ajv;
    this.validateRichPlan = ajv.compile(richPlanSchema);
    this.validateExecutionContract = ajv.compile(executionContractSchema);

    logger.info("SprintPlanValidator initialized", {
      schemas: ["sprint_plan_rich", "execution_contract"],
    });
  }

  private formatErrors(errors: ErrorObject[] | null | undefined): Array<Record<string, unknown>> {
    return (
      errors?.map((e) => ({
        instance_path: e.instancePath,
        schema_path: e.schemaPath,
        keyword: e.keyword,
        message: e.message,
        params: e.params,
      })) ?? []
    );
  }

  /**
   * Validate a rich Sprint Plan response. Performs:
   *  1. JSON-schema validation
   *  2. Cross-field semantic checks: every task in sprint_plan.tasks has a matching
   *     entry in task_specifications; first_task_id is in tasks; dependency_graph is
   *     closed (only references task_ids in the plan) and acyclic; every task spec's
   *     {test_refs, invariant_refs, contract_refs} reference declared sprint-level items.
   */
  async validateRichResponse(payload: unknown): Promise<
    | { ok: true; value: RichSprintLlmResponse }
    | { ok: false; errors: Array<Record<string, unknown>> }
  > {
    await this.ensureCompiled();
    if (!this.validateRichPlan) throw new Error("validator not compiled");

    const isValid = this.validateRichPlan(payload);
    if (!isValid) {
      return { ok: false, errors: this.formatErrors(this.validateRichPlan.errors) };
    }

    const value = payload as RichSprintLlmResponse;
    const semanticErrors = this.checkSemantics(value);
    if (semanticErrors.length > 0) {
      return { ok: false, errors: semanticErrors };
    }

    return { ok: true, value };
  }

  /** Validate a standalone Execution Contract (for Implementer/Verifier brief parsing). */
  async validateExecutionContractValue(payload: unknown): Promise<
    | { ok: true; value: ExecutionContract }
    | { ok: false; errors: Array<Record<string, unknown>> }
  > {
    await this.ensureCompiled();
    if (!this.validateExecutionContract) throw new Error("validator not compiled");

    const isValid = this.validateExecutionContract(payload);
    if (!isValid) {
      return { ok: false, errors: this.formatErrors(this.validateExecutionContract.errors) };
    }
    return { ok: true, value: payload as ExecutionContract };
  }

  /** Returns an array of structured semantic-error records (empty when clean). */
  private checkSemantics(plan: RichSprintLlmResponse): Array<Record<string, unknown>> {
    const errors: Array<Record<string, unknown>> = [];

    const taskIdsInPlan = new Set(plan.sprint_plan.tasks);
    const specIds = new Set(plan.task_specifications.map((s) => s.task_id));

    // Every task in tasks[] must have a corresponding task_specification.
    for (const id of plan.sprint_plan.tasks) {
      if (!specIds.has(id)) {
        errors.push({
          instance_path: "/sprint_plan/tasks",
          keyword: "semantic",
          message: `task '${id}' has no matching entry in task_specifications`,
          params: { task_id: id },
        });
      }
    }
    // Every spec must be in tasks[].
    for (const spec of plan.task_specifications) {
      if (!taskIdsInPlan.has(spec.task_id)) {
        errors.push({
          instance_path: "/task_specifications",
          keyword: "semantic",
          message: `task_specifications entry '${spec.task_id}' is not listed in sprint_plan.tasks`,
          params: { task_id: spec.task_id },
        });
      }
    }

    // first_task_id must be in tasks[].
    if (!taskIdsInPlan.has(plan.first_task_id)) {
      errors.push({
        instance_path: "/first_task_id",
        keyword: "semantic",
        message: `first_task_id '${plan.first_task_id}' is not in sprint_plan.tasks`,
        params: { first_task_id: plan.first_task_id },
      });
    }

    // dependency_graph closure: keys + values must all be in tasks[].
    for (const [k, deps] of Object.entries(plan.sprint_plan.dependency_graph)) {
      if (!taskIdsInPlan.has(k)) {
        errors.push({
          instance_path: `/sprint_plan/dependency_graph/${k}`,
          keyword: "semantic",
          message: `dependency_graph key '${k}' is not in sprint_plan.tasks`,
          params: { task_id: k },
        });
      }
      for (const dep of deps) {
        if (!taskIdsInPlan.has(dep)) {
          errors.push({
            instance_path: `/sprint_plan/dependency_graph/${k}`,
            keyword: "semantic",
            message: `dependency '${dep}' (of '${k}') is not in sprint_plan.tasks`,
            params: { task_id: k, dep },
          });
        }
      }
    }

    // dependency_graph acyclic check (DFS).
    const cycle = this.findCycle(plan.sprint_plan.dependency_graph);
    if (cycle) {
      errors.push({
        instance_path: "/sprint_plan/dependency_graph",
        keyword: "semantic",
        message: `dependency_graph contains a cycle: ${cycle.join(" -> ")}`,
        params: { cycle },
      });
    }

    // task_spec.depends_on closure
    for (const spec of plan.task_specifications) {
      for (const dep of spec.depends_on) {
        if (!taskIdsInPlan.has(dep)) {
          errors.push({
            instance_path: `/task_specifications/${spec.task_id}/depends_on`,
            keyword: "semantic",
            message: `task_specifications['${spec.task_id}'].depends_on references unknown task '${dep}'`,
            params: { task_id: spec.task_id, dep },
          });
        }
      }

      // execution_contract.task_id and sprint_id alignment
      if (spec.execution_contract.task_id !== spec.task_id) {
        errors.push({
          instance_path: `/task_specifications/${spec.task_id}/execution_contract/task_id`,
          keyword: "semantic",
          message: `execution_contract.task_id '${spec.execution_contract.task_id}' does not match enclosing spec '${spec.task_id}'`,
          params: { task_id: spec.task_id, contract_task_id: spec.execution_contract.task_id },
        });
      }
      if (spec.execution_contract.sprint_id !== plan.sprint_plan.sprint_id) {
        errors.push({
          instance_path: `/task_specifications/${spec.task_id}/execution_contract/sprint_id`,
          keyword: "semantic",
          message: `execution_contract.sprint_id '${spec.execution_contract.sprint_id}' does not match plan sprint_id '${plan.sprint_plan.sprint_id}'`,
          params: { task_id: spec.task_id },
        });
      }
    }

    // Sprint-level invariant/contract id sets for ref-checking.
    const invariantIds = new Set(plan.sprint_plan.invariants.map((i) => i.id));
    const contractNames = new Set(plan.sprint_plan.data_contracts.map((c) => c.name));
    const testMatrixTaskIds = new Set(plan.sprint_plan.test_matrix.map((t) => t.task_id));

    for (const spec of plan.task_specifications) {
      for (const ref of spec.invariant_refs) {
        if (!invariantIds.has(ref)) {
          errors.push({
            instance_path: `/task_specifications/${spec.task_id}/invariant_refs`,
            keyword: "semantic",
            message: `invariant_ref '${ref}' is not declared in sprint_plan.invariants`,
            params: { task_id: spec.task_id, ref },
          });
        }
      }
      for (const ref of spec.contract_refs) {
        if (!contractNames.has(ref)) {
          errors.push({
            instance_path: `/task_specifications/${spec.task_id}/contract_refs`,
            keyword: "semantic",
            message: `contract_ref '${ref}' is not declared in sprint_plan.data_contracts`,
            params: { task_id: spec.task_id, ref },
          });
        }
      }
      for (const ref of spec.test_refs) {
        if (!testMatrixTaskIds.has(ref)) {
          errors.push({
            instance_path: `/task_specifications/${spec.task_id}/test_refs`,
            keyword: "semantic",
            message: `test_ref '${ref}' is not present in sprint_plan.test_matrix`,
            params: { task_id: spec.task_id, ref },
          });
        }
      }
    }

    return errors;
  }

  /** Returns a cycle path if found, else null. */
  private findCycle(graph: Record<string, string[]>): string[] | null {
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color: Record<string, number> = {};
    const parent: Record<string, string | null> = {};
    const allNodes = new Set<string>([...Object.keys(graph), ...Object.values(graph).flat()]);
    for (const n of allNodes) color[n] = WHITE;

    const dfs = (u: string): string[] | null => {
      color[u] = GRAY;
      for (const v of graph[u] ?? []) {
        if (color[v] === WHITE) {
          parent[v] = u;
          const c = dfs(v);
          if (c) return c;
        } else if (color[v] === GRAY) {
          const path: string[] = [v];
          let cur: string | null | undefined = u;
          while (cur && cur !== v) {
            path.push(cur);
            cur = parent[cur] ?? null;
          }
          path.push(v);
          return path.reverse();
        }
      }
      color[u] = BLACK;
      return null;
    };

    for (const n of allNodes) {
      if (color[n] === WHITE) {
        parent[n] = null;
        const c = dfs(n);
        if (c) return c;
      }
    }
    return null;
  }
}

export const sprintPlanValidatorService = new SprintPlanValidatorService();
