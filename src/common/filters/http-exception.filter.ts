import { structuredLog } from '../observability/structured-logger.js';
import type { CorrelatedRequest } from '../observability/http-observability.js';
import { Catch, HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ErrorResponseDto } from './error.dto.js';

const messages: Record<number, string> = {
  400: 'La requête est invalide.',
  401: 'Authentification requise.',
  403: 'Accès interdit.',
  404: 'Ressource introuvable.',
  405: 'Méthode non autorisée.',
  413: 'La requête est trop volumineuse.',
  415: 'Le format de la requête est refusé.',
  409: 'La requête est en conflit avec la ressource.',
  422: 'Les données fournies sont invalides.',
  429: 'Trop de requêtes. Réessayer plus tard.',
  500: 'Une erreur interne est survenue.',
  503: 'Un service est temporairement indisponible.',
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const parser =
      typeof exception === 'object' && exception !== null && 'type' in exception
        ? exception.type
        : undefined;
    const parserStatus =
      parser === 'entity.too.large'
        ? 413
        : parser === 'entity.parse.failed'
          ? 400
          : parser === 'encoding.unsupported'
            ? 415
            : undefined;
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : (parserStatus ?? HttpStatus.INTERNAL_SERVER_ERROR);
    const body: ErrorResponseDto = {
      success: false,
      error: {
        code:
          typeof HttpStatus[status] === 'string'
            ? HttpStatus[status]
            : 'HTTP_ERROR',
        message: messages[status] ?? 'La requête ne peut pas être traitée.',
      },
      timestamp: new Date().toISOString(),
      // Ne pas recopier la query string (tokens ou autres valeurs privées).
      path: request.path,
    };
    const payload: unknown =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    if (
      status === 503 &&
      typeof payload === 'object' &&
      payload !== null &&
      'services' in payload
    ) {
      const services: unknown = payload.services;
      if (
        typeof services === 'object' &&
        services !== null &&
        'database' in services &&
        'redis' in services &&
        ['up', 'down'].includes(String(services.database)) &&
        ['up', 'down'].includes(String(services.redis))
      ) {
        body.services = {
          database: services.database as 'up' | 'down',
          redis: services.redis as 'up' | 'down',
        };
      }
    }
    const requestId = (request as CorrelatedRequest).requestId;
    if (requestId) response.setHeader('X-Request-Id', requestId);
    if (status >= 500)
      structuredLog({
        level: 'error',
        module: 'Http',
        event: 'http.error',
        statusCode: status,
        requestId,
      });
    response.status(status).json(body);
  }
}
