import type { RichSprintPlan, TaskSpecification } from "../domain/sprint-plan.types";

/**
 * Deterministic renderer: converts a validated `RichSprintPlan` (+ its task_specifications)
 * into a markdown sprint-plan artifact. Output is byte-stable for a given input — no LLM,
 * no Date.now, no environment input. Snapshot tests can pin its behavior.
 *
 * Markdown layout matches the rich-plan v1 spec: Overview → Design Decisions → Goals →
 * Tasks → Specs → Data Contracts → Test Matrix → Invariants → Dependency Graph →
 * Validation Gates → Definition of Done.
 */
export class SprintPlanRendererService {
  render(plan: RichSprintPlan, specs: TaskSpecification[]): string {
    const sections: string[] = [];

    sections.push(this.header(plan));
    sections.push(this.overview(plan));
    sections.push(this.designDecisions(plan));
    sections.push(this.goals(plan));
    sections.push(this.tasks(plan));
    sections.push(this.taskSpecs(specs));
    sections.push(this.dataContracts(plan));
    sections.push(this.testMatrix(plan));
    sections.push(this.invariants(plan));
    sections.push(this.dependencyGraph(plan));
    sections.push(this.validationGates(plan));
    sections.push(this.definitionOfDone(plan));

    // Stable trailing newline; collapse any accidental trailing blanks.
    return sections.filter((s) => s.length > 0).join("\n\n").replace(/\s+$/g, "") + "\n";
  }

  private header(plan: RichSprintPlan): string {
    return `# Sprint Plan: ${plan.sprint_id}

**Phase:** ${plan.phase_id}
**Name:** ${plan.name}
**Status:** ${plan.status}
**Execution Mode:** ${plan.execution_mode}`;
  }

  private overview(plan: RichSprintPlan): string {
    return `## Overview

**Purpose:** ${plan.overview.purpose}

**Scope:** ${plan.overview.scope}`;
  }

  private designDecisions(plan: RichSprintPlan): string {
    if (plan.design_decisions.length === 0) return "## Design Decisions\n\n_None recorded._";
    const rows = plan.design_decisions
      .map((d) => `| ${esc(d.decision)} | ${esc(d.choice)} | ${esc(d.rationale)} |`)
      .join("\n");
    return `## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
${rows}`;
  }

  private goals(plan: RichSprintPlan): string {
    return `## Goals

${plan.goals.map((g) => `- ${g}`).join("\n")}`;
  }

  private tasks(plan: RichSprintPlan): string {
    return `## Tasks

${plan.tasks.map((t) => `- ${t}`).join("\n")}`;
  }

  private taskSpecs(specs: TaskSpecification[]): string {
    if (specs.length === 0) return "";
    const blocks = specs.map((s) => this.singleTaskSpec(s)).join("\n\n");
    return `## Task Specifications

${blocks}`;
  }

  private singleTaskSpec(s: TaskSpecification): string {
    const lines: string[] = [];
    lines.push(`### ${s.task_id} — ${s.title} [${s.estimated_effort}]`);
    lines.push("");
    lines.push(`**Subsystem:** ${s.subsystem}`);
    lines.push(`**FR IDs:** ${s.fr_ids_in_scope.length ? s.fr_ids_in_scope.join(", ") : "_none_"}`);
    lines.push(`**Depends on:** ${s.depends_on.length ? s.depends_on.join(", ") : "_none_"}`);
    lines.push("");
    lines.push(`**Description:** ${s.description}`);
    lines.push("");
    if (s.inputs.length > 0) {
      lines.push("**Inputs:**");
      lines.push(s.inputs.map((i) => `- \`${i.name}\` (${i.type}) ← ${i.source}`).join("\n"));
      lines.push("");
    }
    if (s.outputs.length > 0) {
      lines.push("**Outputs:**");
      lines.push(s.outputs.map((o) => `- \`${o.name}\` (${o.type}) → ${o.sink}`).join("\n"));
      lines.push("");
    }
    if (s.implementation_notes.length > 0) {
      lines.push("**Implementation notes:**");
      lines.push(s.implementation_notes.map((n) => `- ${n}`).join("\n"));
      lines.push("");
    }
    lines.push("**Acceptance criteria:**");
    lines.push(s.acceptance_criteria.map((c) => `- ${c}`).join("\n"));
    lines.push("");
    lines.push("**Files likely affected:**");
    lines.push(s.files_likely_affected.map((f) => `- \`${f}\``).join("\n"));
    lines.push("");
    if (s.test_refs.length > 0) lines.push(`**Test refs:** ${s.test_refs.join(", ")}`);
    if (s.invariant_refs.length > 0) lines.push(`**Invariant refs:** ${s.invariant_refs.join(", ")}`);
    if (s.contract_refs.length > 0) lines.push(`**Contract refs:** ${s.contract_refs.join(", ")}`);
    return lines.join("\n").trimEnd();
  }

  private dataContracts(plan: RichSprintPlan): string {
    if (plan.data_contracts.length === 0) return "## Data Contracts\n\n_None._";
    const blocks = plan.data_contracts
      .map(
        (c) =>
          `### ${c.name} (${c.kind})\n\n\`\`\`json\n${JSON.stringify(c.json_schema, null, 2)}\n\`\`\``
      )
      .join("\n\n");
    return `## Data Contracts\n\n${blocks}`;
  }

  private testMatrix(plan: RichSprintPlan): string {
    if (plan.test_matrix.length === 0) return "## Test Matrix\n\n_None._";
    const rows = plan.test_matrix
      .map(
        (t) =>
          `| ${t.task_id} | ${(t.normal ?? []).join("; ") || "—"} | ${
            (t.edge ?? []).join("; ") || "—"
          } | ${(t.failure ?? []).join("; ") || "—"} | ${
            (t.idempotency ?? []).join("; ") || "—"
          } |`
      )
      .join("\n");
    return `## Test Matrix

| Task | Normal | Edge | Failure | Idempotency |
|---|---|---|---|---|
${rows}`;
  }

  private invariants(plan: RichSprintPlan): string {
    if (plan.invariants.length === 0) return "## Invariants\n\n_None._";
    const rows = plan.invariants
      .map((i) => `| ${i.id} | ${esc(i.statement)} | ${esc(i.testable_via)} |`)
      .join("\n");
    return `## Invariants

| ID | Statement | Testable via |
|---|---|---|
${rows}`;
  }

  private dependencyGraph(plan: RichSprintPlan): string {
    const keys = Object.keys(plan.dependency_graph).sort();
    if (keys.length === 0) return "## Dependency Graph\n\n_None._";
    const rows = keys
      .map((k) => `- \`${k}\` → ${plan.dependency_graph[k].length ? plan.dependency_graph[k].map((d) => `\`${d}\``).join(", ") : "_(no deps)_"}`)
      .join("\n");
    return `## Dependency Graph

${rows}`;
  }

  private validationGates(plan: RichSprintPlan): string {
    if (plan.validation_gates.length === 0) return "## Validation Gates\n\n_None._";
    return `## Validation Gates

${plan.validation_gates.map((g) => `- ${g}`).join("\n")}`;
  }

  private definitionOfDone(plan: RichSprintPlan): string {
    if (plan.definition_of_done.length === 0) return "## Definition of Done\n\n_None._";
    return `## Definition of Done

${plan.definition_of_done.map((d) => `- ${d}`).join("\n")}`;
  }
}

function esc(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export const sprintPlanRendererService = new SprintPlanRendererService();
