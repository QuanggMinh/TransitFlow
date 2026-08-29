import { Request, Response, NextFunction } from 'express'

export const notFound = (req: Request, res: Response) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` })
}

export const errorHandler = (err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack)
  const status = (err as Error & { status?: number }).status
  const responseStatus = status && status >= 400 && status < 500 ? status : 500
  const message = process.env.NODE_ENV === 'production' && responseStatus === 500
    ? 'Internal server error'
    : err.message || 'Internal server error'
  res.status(responseStatus).json({ success: false, message })
}
