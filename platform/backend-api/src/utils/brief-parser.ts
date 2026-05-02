/**
 * Phase 1 (ADR-033): shared brief parser.
 *
 * The implementation brief at `project_work/ai_project_tasks/active/AI_IMPLEMENTATION_BRIEF.md`
 * is the canonical contract between sprint-controller (writer) and implementer/verifier
 * (readers). Historically the verifier inferred fields ad-hoc via regex; this module
 * centralises parsing into one deterministic helper used by all consumers.
 *
 * The parser is backward compatible: every section returns a safe default when absent.
 *
 * Tagged sections supported:
 *   - `## Acceptance Criteria` — checklist (`- [ ]` / `- [x]`)
 *   - `## Design References` — bullet list of repo-relative file paths
 *   - `## Canonical Values` — verbatim text block
 *   - `## Deliverables Checklist` — checklist of file paths
 *   - `## Execution Contract` — Phase 3 (rich plan): fenced ```json block; binding
 */

import type { ExecutionContract } from "../domain/execution-contract.types";

export interface TaskFlags {
  task_id?: string;
  ui_evidence_required: boolean;
  architecture_contract_change: boolean;
  fr_ids_in_scope: string[];
  incident_tier?: string;
}

export interface AcceptanceCriterion {
  text: string;
  checked: boolean;
}

export interface Deliverable {
  path: string;
  checked: boolean;
}

export interface ParsedBrief {
  acceptanceCriteria: AcceptanceCriterion[];
  designRefs: string[];
  canonicalValues: string;
  deliverables: Deliverable[];
  taskFlags: TaskFlags;
}

const SECTION_HEADINGS = {
  acceptance: /^##\s+Acceptance Criteria\s*$/im,
  designRefs: /^##\s+Design References\s*$/im,
  canonicalValues: /^##\s+Canonical Values\s*$/im,
  deliverables: /^##\s+Deliverables Checklist\s*$/im,
};

/**
 * Extract the contiguous block under a given `##` heading, stopping at the next
 * `##` heading (or end of string). Returns null if the heading is not present.
 */
function extractSection(content: string, heading: RegExp): string | null {
  const match = heading.exec(content);
  if (!match) return null;
  const start = match.index + match[0].length;
  const rest = content.slice(start);
  const next = /^##\s+\S/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

function parseChecklist(block: string | null): { text: string; checked: boolean }[] {
  if (!block) return [];
  const items: { text: string; checked: boolean }[] = [];
  const lineRe = /^\s*[-*]\s*\[( |x|X)\]\s*(.+?)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(block)) !== null) {
    items.push({ text: m[2].trim(), checked: m[1].toLowerCase() === "x" });
  }
  return items;
}

function parseBulletPaths(block: string | null): string[] {
  if (!block) return [];
  const out: string[] = [];
  const lineRe = /^\s*[-*]\s*(?:`([^`]+)`|(\S[^\n]*))\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(block)) !== null) {
    const raw = (m[1] ?? m[2] ?? "").trim();
    if (!raw) continue;
    // Strip surrounding markdown link syntax `[text](path)` -> path
    const linkMatch = /^\[[^\]]*\]\(([^)]+)\)$/.exec(raw);
    out.push(linkMatch ? linkMatch[1].trim() : raw);
  }
  return out;
}

/**
 * Parses the existing task-flags block (JSON or markdown form). Lifted verbatim
 * from `role-verifier.script.ts#parseTaskFlags` so behaviour is preserved.
 */
export function parseTaskFlags(briefContent: string): TaskFlags {
  const flags: TaskFlags = {
    ui_evidence_required: false,
    architecture_contract_change: false,
    fr_ids_in_scope: [],
  };

  // task_id
  const taskIdJson = /"task_id"\s*:\s*"([^"]+)"/.exec(briefContent);
  if (taskIdJson) flags.task_id = taskIdJson[1];
  else {
    const taskIdMd = /\*\*task_id:\*\*\s*(\S+)/.exec(briefContent);
    if (taskIdMd) flags.task_id = taskIdMd[1].trim();
  }

  // ui_evidence_required
  const uiJson = /"ui_evidence_required"\s*:\s*(true|false)/.exec(briefContent);
  if (uiJson) flags.ui_evidence_required = uiJson[1] === "true";
  else {
    const uiMd = /\*\*ui_evidence_required:\*\*\s*(true|false)/i.exec(briefContent);
    if (uiMd) flags.ui_evidence_required = uiMd[1].toLowerCase() === "true";
  }

  // architecture_contract_change
  const archJson = /"architecture_contract_change"\s*:\s*(true|false)/.exec(briefContent);
  if (archJson) flags.architecture_contract_change = archJson[1] === "true";
  else {
    const archMd = /\*\*architecture_contract_change:\*\*\s*(true|false)/i.exec(briefContent);
    if (archMd) flags.architecture_contract_change = archMd[1].toLowerCase() === "true";
  }

  // fr_ids_in_scope
  const frJson = /"fr_ids_in_scope"\s*:\s*\[([^\]]*)\]/.exec(briefContent);
  if (frJson) {
    flags.fr_ids_in_scope = frJson[1]
      .split(",")
      .map((s) => s.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
  } else {
    const frMd = /\*\*fr_ids_in_scope:\*\*\s*([^\n]+)/.exec(briefContent);
    if (frMd) {
      flags.fr_ids_in_scope = frMd[1]
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  // incident_tier
  const tierJson = /"incident_tier"\s*:\s*"([^"]+)"/.exec(briefContent);
  if (tierJson) flags.incident_tier = tierJson[1];
  else {
    const tierMd = /\*\*incident_tier:\*\*\s*(\S+)/.exec(briefContent);
    if (tierMd) flags.incident_tier = tierMd[1].trim();
  }

  return flags;
}

/**
 * Parses a full implementation brief into structured fields.
 * All sections are optional; missing sections produce empty/default values.
 */
export function parseBrief(content: string): ParsedBrief {
  const acceptanceBlock = extractSection(content, SECTION_HEADINGS.acceptance);
  const designRefsBlock = extractSection(content, SECTION_HEADINGS.designRefs);
  const canonicalBlock = extractSection(content, SECTION_HEADINGS.canonicalValues);
  const deliverablesBlock = extractSection(content, SECTION_HEADINGS.deliverables);

  const acceptanceCriteria = parseChecklist(acceptanceBlock);
  const designRefs = parseBulletPaths(designRefsBlock);
  const canonicalValues = canonicalBlock ?? "";
  const deliverables = parseChecklist(deliverablesBlock).map((c) => ({
    path: c.text,
    checked: c.checked,
  }));

  return {
    acceptanceCriteria,
    designRefs,
    canonicalValues,
    deliverables,
    taskFlags: parseTaskFlags(content),
  };
}

/**
 * Phase 3 (deterministic staging): extract the Execution Contract block from a brief.
 *
 * Looks for a `## Execution Contract` heading followed by a fenced ```json block and
 * returns the parsed contract. Returns `null` when the section is absent or the block
 * is malformed (legacy briefs without an execution_contract continue to work).
 *
 * Note: this only parses; structural validation should use
 * `sprintPlanValidatorService.validateExecutionContractValue()` from the validator service.
 */
export function parseExecutionContract(content: string): ExecutionContract | null {
  const headingMatch = /^##\s+Execution Contract\s*$/im.exec(content);
  if (!headingMatch) return null;
  const after = content.slice(headingMatch.index + headingMatch[0].length);
  const fenceMatch = /```json\s*\n([\s\S]*?)\n```/i.exec(after);
  if (!fenceMatch) return null;
  try {
    return JSON.parse(fenceMatch[1]) as ExecutionContract;
  } catch {
    return null;
  }
}
