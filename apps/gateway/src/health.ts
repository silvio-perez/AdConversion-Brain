/**
 * Placeholder for the Brain Gateway (MCP + REST). Milestone 0 only proves the
 * toolchain end to end; real endpoints arrive in Milestone 2.
 */
export interface HealthStatus {
  service: "brain-gateway";
  status: "ok";
}

export function health(): HealthStatus {
  return { service: "brain-gateway", status: "ok" };
}
