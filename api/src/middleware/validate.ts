import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: result.error.issues.map(i => i.message).join(', '),
        code: 'VALIDATION_ERROR',
        retryable: false,
      });
    }
    req.body = result.data;
    next();
  };
}
