/**
 * Common validation result types. Family rules produce these; the UI renders
 * them with a stable code, a human message and a link to the affected field.
 */

export type IssueSeverity = "error" | "warning" | "info";

export interface ValidationRef {
  /** App screen the issue belongs to, e.g. "signals" | "devices" | "configuration". */
  screen: "signals" | "devices" | "configuration" | "deploy";
  entity: "signal" | "device" | "project" | "gateway";
  /** Signal index, device id… */
  id?: number | string;
  /** Field within the entity, e.g. "groupAddress" | "readFunc". */
  field?: string;
}

export interface ValidationIssue {
  /** Stable machine code, e.g. "KNX-FLAGS-RI-R". Never reuse codes. */
  code: string;
  severity: IssueSeverity;
  /** Human-readable English message. */
  message: string;
  ref?: ValidationRef;
}

/** Errors block saving/deploying; warnings and info do not. */
export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}
