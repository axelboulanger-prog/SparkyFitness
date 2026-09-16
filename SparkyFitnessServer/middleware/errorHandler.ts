import { log } from '../config/logging.js';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const errorHandler = (err: any, _req: any, res: any, _next: any) => {
  log(
    'error',
    `Error caught by centralized handler: ${err.message}`,
    err.stack
  );
  // Default to 500 Internal Server Error
  let statusCode = err.status || err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let code: string | undefined =
    typeof err.code === 'string' ? err.code : undefined;

  if (
    err.name === 'PayloadTooLargeError' ||
    err.type === 'entity.too.large' ||
    statusCode === 413
  ) {
    statusCode = 413;
    code = 'IMAGE_TOO_LARGE';
    message = 'Request payload too large. Please reduce the image size.';
  } else {
    // Handle specific error types if needed (e.g., database errors, validation errors)
    switch (err.name) {
      case 'UnauthorizedError':
        statusCode = 401;
        message = 'Unauthorized: Invalid or missing token.';
        break;
      case 'ForbiddenError':
        statusCode = 403;
        message =
          'Forbidden: You do not have permission to perform this action.';
        break;
      case 'ValidationError':
        statusCode = 400;
        message = err.message;
        break;
      default:
        if (err.code === '23505') {
          statusCode = 409;
          message =
            'Conflict: A resource with this unique identifier already exists.';
        }
        break;
    }
  }
  res.status(statusCode).json({
    error: message,
    code,
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined, // Only send stack in development
  });
};
export default errorHandler;
