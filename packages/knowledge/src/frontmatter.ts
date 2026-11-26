import { parse } from "yaml";

export const DOC_TYPES = [
  "index",
  "business-context",
  "product-marketing",
  "brand-guidelines",
  "design-system",
  "strategy",
  "learning",
  "methodology",
  "sop",
] as const;

const STATUSES = ["draft", "approved", "deprecated"] as const;
const SOURCE_KINDS = ["grain", "document", "manual"] as const;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ValidationContext {
  /** Repository the file lives in, e.g. "client-acme-analytics" or "company". */
  repo: string;
  /** Path inside the repository, e.g. "learnings/2026-10-test.md". */
  path: string;
  /** Fixtures must be flagged synthetic (SEC-DATA-6). */
  requireSynthetic: boolean;
}

/** Split a markdown file into its YAML frontmatter object (or null) and body. */
export function splitFrontmatter(source: string): { data: unknown; body: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match) return null;
  return { data: parse(match[1] ?? ""), body: source.slice(match[0].length) };
}

/** Client slug a repository must declare: "client-acme" -> "acme", others -> null. */
export function expectedClient(repo: string): string | null {
  return repo.startsWith("client-") ? repo.slice("client-".length) : null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Return a list of human-readable problems. Empty means the document is valid. */
/** Files inside a skill folder (other than SKILL.md) are resources, not knowledge documents. */
export function isSkillResource(repo: string, path: string): boolean {
  return repo === "skills" && path.includes("/") && !path.endsWith("/SKILL.md");
}

export function validateDocument(source: string, ctx: ValidationContext): string[] {
  if (isSkillResource(ctx.repo, ctx.path)) return [];
  const split = splitFrontmatter(source);
  if (!split) return ["missing frontmatter block (--- ... ---) at top of file"];
  const fm = split.data;
  if (!isRecord(fm)) return ["frontmatter must be a YAML mapping"];

  const errors: string[] = [];
  const isSkill = ctx.path.endsWith("SKILL.md");

  if (isSkill) {
    const folder = ctx.path.split("/").at(-2);
    if (typeof fm.name !== "string" || !SLUG.test(fm.name)) errors.push("name must be a slug");
    else if (fm.name !== folder) errors.push(`name "${fm.name}" must match folder "${folder}"`);
    if (typeof fm.description !== "string" || fm.description.trim().length < 20)
      errors.push("description must be a sentence of at least 20 characters");
  } else {
    if (typeof fm.title !== "string" || !fm.title.trim()) errors.push("title is required");
    if (!DOC_TYPES.includes(fm.type as never))
      errors.push(`type must be one of: ${DOC_TYPES.join(", ")}`);
    const want = expectedClient(ctx.repo);
    if (fm.client !== want)
      errors.push(`client must be ${want === null ? "null" : `"${want}"`} in repo ${ctx.repo}`);
    if (typeof fm.owner !== "string" || !fm.owner.trim()) errors.push("owner is required");
    if (!STATUSES.includes(fm.status as never))
      errors.push(`status must be one of: ${STATUSES.join(", ")}`);
    // YAML parses unquoted dates as strings with the `yaml` core schema.
    if (typeof fm.last_reviewed !== "string" || !DATE.test(fm.last_reviewed))
      errors.push("last_reviewed must be YYYY-MM-DD");
    if (!Array.isArray(fm.sources)) errors.push("sources must be a list (may be empty)");
    else
      fm.sources.forEach((s, i) => {
        if (!isRecord(s) || !SOURCE_KINDS.includes(s.kind as never))
          errors.push(`sources[${i}].kind must be one of: ${SOURCE_KINDS.join(", ")}`);
        else if (typeof s.ref !== "string" || !s.ref) errors.push(`sources[${i}].ref is required`);
      });
  }

  if (ctx.requireSynthetic && fm.synthetic !== true)
    errors.push("fixtures must set synthetic: true");
  return errors;
}
