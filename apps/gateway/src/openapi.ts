// OpenAPI description of the REST API, for harnesses without MCP support
// (Custom GPT Actions, Gemini/OpenAI function calling, automation tools).
const err = { description: "Not found (also returned for sources you cannot access)" };
const auth = [{ bearer: [] }];
const sourceParam = { name: "source", in: "path", required: true, schema: { type: "string" } };

export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "AdConversion Brain",
    version: "0.1.0",
    description:
      "Read-only access to approved company and client knowledge. Scope is set by your token.",
  },
  components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } },
  security: auth,
  paths: {
    "/v1/whoami": {
      get: {
        operationId: "whoami",
        summary: "Identity and accessible sources",
        responses: { 200: { description: "OK" } },
      },
    },
    "/v1/sources": {
      get: {
        operationId: "listSources",
        summary: "List accessible knowledge sources",
        responses: { 200: { description: "OK" } },
      },
    },
    "/v1/sources/{source}/documents": {
      get: {
        operationId: "listDocuments",
        summary: "List documents in a source",
        parameters: [sourceParam, { name: "prefix", in: "query", schema: { type: "string" } }],
        responses: { 200: { description: "OK" }, 404: err },
      },
    },
    "/v1/sources/{source}/documents/{path}": {
      get: {
        operationId: "readDocument",
        summary: "Read a document (path may contain slashes)",
        parameters: [
          sourceParam,
          { name: "path", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { 200: { description: "OK" }, 404: err },
      },
    },
    "/v1/search": {
      get: {
        operationId: "search",
        summary: "Full-text search across accessible sources",
        parameters: [
          { name: "q", in: "query", required: true, schema: { type: "string" } },
          { name: "source", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 25 } },
        ],
        responses: { 200: { description: "OK" }, 404: err },
      },
    },
    "/v1/skills": {
      get: {
        operationId: "listSkills",
        summary: "Published skills",
        responses: { 200: { description: "OK" }, 404: err },
      },
    },
    "/v1/skills/{name}": {
      get: {
        operationId: "getSkill",
        summary: "A published skill's instructions and file list",
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "OK" }, 404: err },
      },
    },
    "/v1/skills/{name}/bundle": {
      get: {
        operationId: "getSkillBundle",
        summary: "All files of a published skill, for local installation",
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "OK" }, 404: err },
      },
    },
    "/v1/skills/{name}/files/{path}": {
      get: {
        operationId: "readSkillFile",
        summary: "One file of a published skill",
        parameters: [
          { name: "name", in: "path", required: true, schema: { type: "string" } },
          { name: "path", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { 200: { description: "OK" }, 404: err },
      },
    },
    "/v1/proposals": {
      get: {
        operationId: "listProposals",
        summary: "Recent proposals in accessible sources",
        parameters: [{ name: "source", in: "query", schema: { type: "string" } }],
        responses: { 200: { description: "OK" } },
      },
    },
    "/v1/sources/{source}/proposals": {
      post: {
        operationId: "propose",
        summary:
          "Propose a change for human review. Include base_revision (from readDocument) to update; omit it to create a new document.",
        parameters: [sourceParam],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["path", "content", "summary"],
                properties: {
                  path: { type: "string" },
                  content: { type: "string", description: "Full document including frontmatter" },
                  base_revision: { type: "string" },
                  summary: { type: "string" },
                  evidence: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["kind", "ref"],
                      properties: {
                        kind: { type: "string", enum: ["grain", "document", "manual"] },
                        ref: { type: "string" },
                        at: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Proposal opened" },
          403: { description: "Token is read-only" },
          404: err,
          409: { description: "Document changed since it was read" },
          422: { description: "Invalid proposal (see problems)" },
          429: { description: "Too many proposals" },
        },
      },
    },
  },
} as const;
