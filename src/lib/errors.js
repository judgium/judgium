export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, message, details) => new HttpError(400, code, message, details);
export const unauthorized = (message = 'Not signed in') => new HttpError(401, 'unauthorized', message);
// Distinct from `unauthorized` so a client can tell "wrong password" from
// "your session expired" - those need very different wording.
export const invalidCredentials = (message = 'E-mail or password is incorrect') =>
  new HttpError(401, 'invalid_credentials', message);
export const forbidden = (message = 'Not allowed') => new HttpError(403, 'forbidden', message);
// Distinct code so the client can say "your account was suspended" instead of
// the generic "not allowed" it shows for an ordinary permission failure.
export const accountSuspended = (
  message = 'This account has been suspended. Contact the platform administrator.',
) => new HttpError(403, 'account_suspended', message);
export const notFound = (message = 'Not found') => new HttpError(404, 'not_found', message);
export const conflict = (code, message) => new HttpError(409, code, message);
export const tooMany = (message = 'Too many requests') => new HttpError(429, 'rate_limited', message);
