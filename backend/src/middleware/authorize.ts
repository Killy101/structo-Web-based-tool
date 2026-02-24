import { Response, NextFunction } from 'express';
import { AuthRequest } from './authenticate';
import prisma from '../lib/prisma';

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden - insufficient permissions' });
    }

    next();
  };
};