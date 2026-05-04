/**
 * Execution Contract Enforcer (Phase 4 / ADR-033).
 *
 * Single deterministic checker shared by Implementer (pre-action tool guards) and
 * Verifier (post-hoc audit). Centralising the logic guarantees both roles agree on
 * what counts as a CONTRACT_VIOLATION — there is exactly one source of truth.
 *
 * Detectors are intentionally cheap, regex/glob-based, and non-LLM. They run on the
 * inputs already available to the calling role (the contract, the proposed write
 * path or command, and the file content for content scans). No filesystem I/O is
 * performed here so the service stays pure and easy to test.
 *
 * Failure shape: every check returns `{ ok: true }` on success or
 * `{ ok: false, code: "CONTRACT_VIOLATION", reason, detail? }`. The Implementer
 * surfaces the reason verbatim to the agent loop; the Verifier records it as a
 * blocker reason in `verification_result.json`.
 */

import type { ExecutionContract } from "../domain/execution-contract.types";

export type EnforcementResult =
  | { ok: true }
  | { ok: false; code: "CONTRACT_VIOLATION"; reason: string; detail?: string };

const ok = (): EnforcementResult => ({ ok: true });
const fail = (reason: string, detail?: string): EnforcementResult => ({
  ok: false,
  code: "CONTRACT_VIOLATION",
  reason,
  detail,
});

/**
 * Convert a glob-like path pattern into a RegExp. Supports `**` (any depth, any
 * characters incl. `/`), `*` (one path segment, no `/`), and `?` (single char).
 * This is the same dialect used by the renderer's allowed_paths field — kept
 * minimal to avoid depending on a glob library at runtime.
 */
function globToRegExp(glob: string): RegExp {
  // Escape regex metacharacters except *, ?, /
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      // Lookahead for **
      if (glob[i + 1] === "*") {
        out += ".*";
        i++;
        // Optional trailing slash after ** (e.g. "src/**/foo.ts")
        if (glob[i + 1] === "/") {
          i++;
        }
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  return new RegExp(`^${out}$`);
}

/** Normalise a repo-relative path: strip leading `./` and `/`, force forward slashes. */
function normalisePath(p: string): string {
  return p.replace(/^\.\//, "").replace(/^\/+/, "").replace(/\\/g, "/");
}

/**
 * Allowed-paths gate (Implementer `write_file` precondition).
 *
 * Permits the write iff `relPath` matches at least one entry in
 * `scope.allowed_paths` ∪ `scope.allowed_paths_extra`. Empty allow-lists deny all
 * writes — a contract with no allowed paths is intentionally restrictive and
 * indicates the Planner believed the task required no source edits.
 */
export function checkWriteAllowed(contract: ExecutionContract, relPath: string): EnforcementResult {
  const norm = normalisePath(relPath);
  const patterns = [...contract.scope.allowed_paths, ...(contract.scope.allowed_paths_extra ?? [])];
  if (patterns.length === 0) {
    return fail("write rejected: contract has no allowed_paths", `path=${norm}`);
  }
  const matched = patterns.some((pat) => globToRegExp(normalisePath(pat)).test(norm));
  if (!matched) {
    return fail(
      "write rejected: path is outside contract.scope.allowed_paths",
      `path=${norm} | allowed=${patterns.join(", ")}`
    );
  }
  return ok();
}

/**
 * Run-command gate (Implementer `run_command` precondition).
 *
 * Permits the command iff its exact string matches one of the contract's three
 * canonical commands (lint / typecheck / test), or the declared
 * `dependencies.install_command` when present. The Implementer is encouraged to
 * call these script-runner aliases verbatim; arbitrary shell strings are blocked
 * to keep the gate set deterministic and reproducible across environments.
 */
export function checkCommandAllowed(contract: ExecutionContract, command: string): EnforcementResult {
  const allowed = [contract.commands.lint, contract.commands.typecheck, contract.commands.test]
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  // Also permit the declared install_command so the agent can bootstrap deps
  // when auto-install didn't fire (e.g. working_directory absent on prior staging).
  const installCmd = contract.dependencies?.install_command?.trim();
  if (installCmd) allowed.push(installCmd);
  const trimmed = command.trim();
  if (!allowed.includes(trimmed)) {
    const allowedNames = ["lint", "typecheck", "test"];
    if (installCmd) allowedNames.push("install");
    return fail(
      `command rejected: not in contract.commands {${allowedNames.join(", ")}}`,
      `command=${trimmed} | allowed=${allowed.join(" | ")}`
    );
  }
  return ok();
}

/**
 * Determinism content scans for a file write.
 *
 * When `determinism.no_randomness` is set, rejects content containing
 * `Math.random`, `crypto.randomUUID`, `randomBytes`, or `Date.now()` used outside
 * of test files. When `determinism.no_external_calls` is set, rejects new uses of
 * `fetch(`, `http.request`, `https.request`, `axios.`, or `XMLHttpRequest`.
 *
 * The detectors are deliberately conservative — false positives are preferable to
 * silent contract drift, and the agent can always set the flag to false in the
 * contract if the task legitimately needs randomness or network access.
 */
export function checkContentDeterminism(
  contract: ExecutionContract,
  relPath: string,
  content: string
): EnforcementResult {
  const norm = normalisePath(relPath);
  const isTest = /(^|\/)(__tests__|tests?)\//.test(norm) || /\.(test|spec)\.[tj]sx?$/.test(norm);

  if (contract.determinism.no_randomness && !isTest) {
    const hits: string[] = [];
    if (/\bMath\.random\s*\(/.test(content)) hits.push("Math.random()");
    if (/\bcrypto\.randomUUID\s*\(/.test(content)) hits.push("crypto.randomUUID()");
    if (/\brandomBytes\s*\(/.test(content)) hits.push("randomBytes()");
    // Date.now() in non-test code is a common non-determinism source.
    if (/\bDate\.now\s*\(/.test(content)) hits.push("Date.now()");
    if (hits.length > 0) {
      return fail(
        "write rejected: contract.determinism.no_randomness=true but content uses randomness/clock",
        `path=${norm} | hits=${hits.join(", ")}`
      );
    }
  }

  if (contract.determinism.no_external_calls) {
    const hits: string[] = [];
    if (/\bfetch\s*\(/.test(content)) hits.push("fetch(");
    if (/\bhttps?\.request\s*\(/.test(content)) hits.push("http(s).request(");
    if (/\baxios\./.test(content)) hits.push("axios.");
    if (/\bXMLHttpRequest\b/.test(content)) hits.push("XMLHttpRequest");
    if (hits.length > 0) {
      return fail(
        "write rejected: contract.determinism.no_external_calls=true but content makes network calls",
        `path=${norm} | hits=${hits.join(", ")}`
      );
    }
  }

  return ok();
}

/**
 * Manifest dependency-diff gate.
 *
 * When the Implementer writes `package.json`, this compares the previous and
 * proposed `dependencies` + `devDependencies` maps and rejects any added or
 * upgraded entry whose package name is not listed in
 * `contract.dependencies.allowed`. Removed entries are permitted (cleanup is
 * not a contract violation).
 *
 * Both inputs are the raw file contents; if either parse fails we conservatively
 * pass (the JS will fail at install time and surface the issue).
 */
export function checkManifestDependencyDiff(
  contract: ExecutionContract,
  beforeContent: string | null,
  afterContent: string
): EnforcementResult {
  let before: Record<string, string> = {};
  let after: Record<string, string> = {};
  try {
    if (beforeContent) {
      const parsed = JSON.parse(beforeContent) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      before = { ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) };
    }
    const parsed = JSON.parse(afterContent) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    after = { ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) };
  } catch {
    return ok();
  }

  const allowed = new Set(contract.dependencies.allowed);
  const offenders: string[] = [];
  for (const [name, version] of Object.entries(after)) {
    if (before[name] !== version && !allowed.has(name)) {
      offenders.push(`${name}@${version}`);
    }
  }
  if (offenders.length > 0) {
    return fail(
      "package.json change rejected: added/upgraded packages outside contract.dependencies.allowed",
      `offenders=${offenders.join(", ")}`
    );
  }
  return ok();
}

/**
 * Pre-finish gate.
 *
 * Verifies that, before the Implementer terminates the loop, all three contract
 * commands have produced an `exit_code === 0` GateResult. Re-runs are allowed —
 * the caller passes the latest result per command. Returns CONTRACT_VIOLATION
 * with the missing/failing commands enumerated.
 */
export function checkPreFinishGates(
  contract: ExecutionContract,
  results: { command: string; exit_code: number }[]
): EnforcementResult {
  // Respect success_criteria: only require gates where the corresponding flag is true.
  const sc = contract.success_criteria;
  const commandRequired = (cmd: string): boolean => {
    const c = cmd.trim();
    if (c === contract.commands.lint.trim()) return sc?.lint_pass ?? true;
    if (c === contract.commands.typecheck.trim()) return sc?.typecheck_pass ?? true;
    if (c === contract.commands.test.trim()) return sc?.all_tests_pass ?? true;
    return true;
  };
  const required = [contract.commands.lint, contract.commands.typecheck, contract.commands.test]
    .map((c) => c.trim())
    .filter(commandRequired);
  const passing = new Set(
    results
      .filter((r) => r.exit_code === 0)
      .map((r) => r.command.trim())
  );
  const missing = required.filter((c) => !passing.has(c));
  if (missing.length > 0) {
    return fail(
      "finish rejected: required contract gates have not all passed",
      `missing_or_failing=${missing.join(" | ")}`
    );
  }
  return ok();
}

/**
 * Singleton facade used by Implementer + Verifier. Exposed as an object so call
 * sites read ergonomically (`enforcer.checkWriteAllowed(...)`).
 */
export const executionContractEnforcer = {
  checkWriteAllowed,
  checkCommandAllowed,
  checkContentDeterminism,
  checkManifestDependencyDiff,
  checkPreFinishGates,
} as const;

export type ExecutionContractEnforcer = typeof executionContractEnforcer;
