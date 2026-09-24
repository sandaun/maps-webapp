/** Service error carrying an HTTP status, rendered by `http.ts`. */
export class ProjectServiceError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Machine-readable reason, e.g. "revision-conflict". */
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ProjectServiceError";
  }
}
