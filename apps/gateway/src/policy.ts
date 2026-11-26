import { readFileSync } from "node:fs";
import { expectedClient } from "@brain/knowledge";

export interface VendorPolicy {
  approvedVendors: string[];
  clientOverrides: Record<string, string[]>;
}

export function loadVendorPolicy(file: string): VendorPolicy {
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<VendorPolicy>;
  if (!Array.isArray(raw.approvedVendors)) throw new Error(`${file}: approvedVendors missing`);
  return { approvedVendors: raw.approvedVendors, clientOverrides: raw.clientOverrides ?? {} };
}

/** May knowledge from `source` be sent to an agent running on `vendor`? */
export function vendorAllowed(policy: VendorPolicy, source: string, vendor: string): boolean {
  const client = expectedClient(source);
  const allowed = (client && policy.clientOverrides[client]) || policy.approvedVendors;
  return allowed.includes(vendor);
}
