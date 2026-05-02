/**
 * Builds a project-scoped preamble to prepend to LLM system prompts.
 * Injects prompt_role and prompt_context from the project record so the LLM
 * operates within the project's defined expertise, constraints, and boundaries.
 */
export function buildProjectPreamble(
  project: { prompt_role: string | null; prompt_context: string | null } | null
): string {
  if (!project) return "";
  const { prompt_role, prompt_context } = project;
  if (!prompt_role && !prompt_context) return "";

  const parts: string[] = [
    "You are operating under the following Role and Context. These define your expertise, constraints, and system boundaries. You MUST adhere to them in all decisions.",
  ];
  if (prompt_role) parts.push(prompt_role);
  if (prompt_context) parts.push(prompt_context);
  parts.push("---");

  return parts.join("\n\n") + "\n\n";
}
