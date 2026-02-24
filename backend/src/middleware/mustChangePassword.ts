import { Response, NextFunction } from 'express';
import { AuthRequest } from './authenticate';

export const checkMustChangePassword = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.mustChangePassword) {
    return res.status(403).json({
      error: 'Password change required',
      mustChangePassword: true
    });
  }
  next();
};