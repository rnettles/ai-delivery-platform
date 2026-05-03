/**
 * Utility to parse design references from pipeline artifact markdown files.
 *
 * Used by useStepDesignRefs to extract the design-context scope for each
 * pipeline role step (planner, sprint-controller, implementer, verifier).
 */

export interface DesignRef {
  kind: "fr-id" | "required-artifact" | "file-path";
  /** FR identifier (e.g. "FR-1.1"), required artifact title, or repo-relative file path */
  value: string;
  /** Artifact type for required-artifact (TDN, ADR, Spike); inferred category for file-path */
  category?: string;
  /** For required-artifact: Required | Exists | Approved */
  status?: string;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function extractSection(content: string, heading: RegExp): string | null {
  const match = heading.exec(content);
  if (!match) return null;
  const start = match.index + match[0].length;
  const rest = content.slice(start);
  const next = /^##\s+\S/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

/** Bullet list of FR IDs from `## FR IDs in Scope` (phase plan) */
function parseFrIdBullets(block: string | null): DesignRef[] {
  if (!block) return [];
  const refs: DesignRef[] = [];
  const lineRe = /^\s*[-*]\s*(\S+)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(block)) !== null) {
    const id = m[1].trim();
    if (id && id !== "None") refs.push({ kind: "fr-id", value: id });
  }
  return refs;
}

/** Markdown table rows from `## Required Design Artifacts` (phase plan) */
function parseRequiredArtifactsTable(block: string | null): DesignRef[] {
  if (!block) return [];
  const refs: DesignRef[] = [];
  // Match table rows: | Type | Title | Status |
  const rowRe = /^\|\s*(TDN|ADR|Spike)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/gim;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(block)) !== null) {
    const title = m[2].trim();
    if (title) {
      refs.push({
        kind: "required-artifact",
        category: m[1].trim(),
        value: title,
        status: m[3].trim(),
      });
    }
  }
  return refs;
}

/** FR IDs from `## Task Flags` section in implementation brief (JSON or list format) */
function parseFrIdsFromTaskFlags(block: string | null): DesignRef[] {
  if (!block) return [];

  // Try JSON fenced block: ```json { "fr_ids_in_scope": [...] } ```
  const jsonMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(block);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]) as Record<string, unknown>;
      if (Array.isArray(parsed.fr_ids_in_scope)) {
        return (parsed.fr_ids_in_scope as unknown[])
          .filter((v) => typeof v === "string")
          .map((id) => ({ kind: "fr-id" as const, value: id as string }));
      }
    } catch {
      // fall through to markdown list format
    }
  }

  // Try markdown list: - **fr_ids_in_scope:** ["FR-1.1", "FR-1.2"]
  const listMatch = /\*\*fr_ids_in_scope:\*\*\s*(\[.*?\])/i.exec(block);
  if (listMatch) {
    try {
      const ids = JSON.parse(listMatch[1]) as unknown[];
      return ids
        .filter((v) => typeof v === "string")
        .map((id) => ({ kind: "fr-id" as const, value: id as string }));
    } catch {
      // ignore
    }
  }

  return [];
}

function inferCategory(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.includes("/adr/") || /adr[-_]/.test(lower)) return "ADR";
  if (lower.includes("/prd/") || /prd[-_]/.test(lower)) return "PRD";
  if (
    lower.includes("/functional_requirements/") ||
    /frd[-_]/.test(lower) ||
    /fr[-_]/.test(lower)
  )
    return "FR";
  if (lower.includes("/tdn/") || /tdn[-_]/.test(lower)) return "TDN";
  return "DOC";
}

/** File paths from `## Design References` bullet list (brief or any artifact) */
function parseDesignRefPaths(block: string | null): DesignRef[] {
  if (!block) return [];
  const refs: DesignRef[] = [];
  const lineRe = /^\s*[-*]\s*(?:`([^`]+)`|(\S[^\n]*))\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(block)) !== null) {
    const raw = (m[1] ?? m[2] ?? "").trim();
    if (!raw) continue;
    // Strip markdown link syntax [text](path) → path
    const linkMatch = /^\[[^\]]*\]\(([^)]+)\)$/.exec(raw);
    const pathVal = linkMatch ? linkMatch[1].trim() : raw;
    refs.push({ kind: "file-path", value: pathVal, category: inferCategory(pathVal) });
  }
  return refs;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse design references from a **phase plan** markdown file.
 * Extracts FR IDs from `## FR IDs in Scope` and required artifacts from
 * `## Required Design Artifacts`.
 */
export function parsePhasePlanRefs(content: string): DesignRef[] {
  const frSection = extractSection(content, /^##\s+FR IDs in Scope\s*$/im);
  const designSection = extractSection(content, /^##\s+Required Design Artifacts\s*$/im);
  return [
    ...parseFrIdBullets(frSection),
    ...parseRequiredArtifactsTable(designSection),
  ];
}

/**
 * Parse design references from an **implementation brief** markdown file.
 * Extracts `fr_ids_in_scope` from `## Task Flags` and file paths from
 * the optional `## Design References` section.
 */
export function parseBriefRefs(content: string): DesignRef[] {
  const flagsSection = extractSection(content, /^##\s+Task Flags\s*$/im);
  const designRefsSection = extractSection(content, /^##\s+Design References\s*$/im);
  return [
    ...parseFrIdsFromTaskFlags(flagsSection),
    ...parseDesignRefPaths(designRefsSection),
  ];
}
