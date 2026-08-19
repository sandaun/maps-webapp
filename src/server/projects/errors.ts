/** Service error carrying an HTTP status, rendered by `http.ts`. */
export class ProjectServiceError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ProjectServiceError";
  }
}
