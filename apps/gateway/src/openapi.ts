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
  },
} as const;
