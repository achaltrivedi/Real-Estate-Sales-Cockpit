/** Domain error with an HTTP status. Thrown by services, turned into `ApiError` JSON by the error handler. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
