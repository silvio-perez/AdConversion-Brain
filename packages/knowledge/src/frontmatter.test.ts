import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { validateDocument } from "./frontmatter.ts";

const valid = `---
title: Brand
type: brand-guidelines
client: acme-analytics
owner: alice
status: approved
last_reviewed: 2026-11-20
sources:
  - kind: grain
    ref: m-1
synthetic: true
---
# Body
`;
const ctx = { repo: "client-acme-analytics", path: "brand-guidelines.md", requireSynthetic: true };

describe("validateDocument", () => {
  it("accepts a well-formed client document", () => {
    expect(validateDocument(valid, ctx)).toEqual([]);
  });

  it("rejects a document filed in the wrong client's repository", () => {
    const errors = validateDocument(valid, { ...ctx, repo: "client-globex-cloud" });
    expect(errors).toContain('client must be "globex-cloud" in repo client-globex-cloud');
  });

  it("requires client: null in the company repository", () => {
    expect(validateDocument(valid, { ...ctx, repo: "company" })).toContain(
      "client must be null in repo company",
    );
  });

  it("rejects missing frontmatter", () => {
    expect(validateDocument("# no frontmatter", ctx)).toHaveLength(1);
  });

  it("rejects unknown type, status and source kind", () => {
    const bad = valid
      .replace("brand-guidelines", "memo")
      .replace("approved", "final")
      .replace("kind: grain", "kind: email");
    expect(validateDocument(bad, ctx)).toHaveLength(3);
  });

  it("requires synthetic: true for fixtures", () => {
    const real = valid.replace("synthetic: true\n", "");
    expect(validateDocument(real, ctx)).toContain("fixtures must set synthetic: true");
  });

  it("treats files inside a skill folder as resources, not documents", () => {
    const ctx2 = {
      repo: "skills",
      path: "meeting-recap/templates/recap.md",
      requireSynthetic: true,
    };
    expect(validateDocument("## just a template", ctx2)).toEqual([]);
    expect(
      validateDocument("## no frontmatter", { ...ctx2, repo: "company", path: "a/b.md" }),
    ).toHaveLength(1);
  });

  it("checks skill name matches its folder", () => {
    const skill =
      "---\nname: other\ndescription: A sufficiently long description here.\nsynthetic: true\n---\n";
    const errors = validateDocument(skill, { ...ctx, repo: "skills", path: "ad-copy/SKILL.md" });
    expect(errors).toEqual(['name "other" must match folder "ad-copy"']);
  });
});

// Every fixture must satisfy the conventions; this doubles as `pnpm check:knowledge`.
const root = join(import.meta.dirname, "../../../fixtures/synthetic");
function* markdownFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* markdownFiles(full);
    else if (entry.name.endsWith(".md")) yield full;
  }
}

describe("synthetic fixtures", () => {
  const files = [...markdownFiles(root)];
  it("exist", () => expect(files.length).toBeGreaterThan(5));
  it.each(files.map((f) => relative(root, f)))("%s follows the conventions", (rel) => {
    const [repo = "", ...rest] = rel.split(sep);
    const source = readFileSync(join(root, rel), "utf8");
    expect(
      validateDocument(source, { repo, path: rest.join("/"), requireSynthetic: true }),
    ).toEqual([]);
  });
});
