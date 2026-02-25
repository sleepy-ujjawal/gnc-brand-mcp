import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  console.error('Error:', err.message ?? err);
  const status = err.status ?? 500;
  res.status(status).json({
    error: err.message ?? 'Internal server error',
    code: err.code ?? 'INTERNAL_ERROR',
    retryable: status >= 500,
  });
}
