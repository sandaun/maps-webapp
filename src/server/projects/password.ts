import "server-only";
import type { XmlDocument } from "@/core/project-format";
import { isDeployPasswordValid, isNewProjectPasswordValid, PROJECT_PASSWORD_INPUT_HINT } from "@/core/validation/project-password";
import { ProjectServiceError } from "./errors";

/** Only this boolean leaves the server; Pwd is deliberately absent from family models. */
export function hasValidProjectPassword(doc: XmlDocument): boolean {
  return isDeployPasswordValid(doc.getAttr(["IBOX"], "Pwd") ?? "");
}

/** Shared write-only operation. Connection/Pwd authenticates the existing gateway and is untouched. */
export function setProjectPassword(doc: XmlDocument, password: string): void {
  if (!isNewProjectPasswordValid(password)) {
    throw new ProjectServiceError(422, PROJECT_PASSWORD_INPUT_HINT);
  }
  if (!doc.find(["IBOX"])) {
    throw new ProjectServiceError(422, "The project has no gateway configuration.");
  }
  doc.setAttr(["IBOX"], "Pwd", password);
}
