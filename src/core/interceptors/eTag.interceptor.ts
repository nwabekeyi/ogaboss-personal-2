import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
    HttpException,
    HttpStatus,
  } from '@nestjs/common';
  import { Observable } from 'rxjs';
  import { map } from 'rxjs/operators';
  import { createHash } from 'crypto';
  import { Response } from 'express';

  @Injectable()
  export class ETagInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
      const response = context.switchToHttp().getResponse<Response>();
      const request = context.switchToHttp().getRequest<Request>();

      return next.handle().pipe(
        map((data) => {
          if (!data || response.headersSent) {
            return data;
          }

          const bodyString = JSON.stringify(data);
          const etag = `"${createHash('md5').update(bodyString).digest('hex')}"`;

          const clientEtag = request.headers['if-none-match'];
          if (clientEtag && (clientEtag === etag || clientEtag.replace(/"/g, '') === etag.replace(/"/g, ''))) {
            // Correct way: throw HttpException with 304
            throw new HttpException('Not Modified', HttpStatus.NOT_MODIFIED);
          }

          response.setHeader('ETag', etag);
          response.setHeader('Cache-Control', 'private, max-age=60');

          return data;
        }),
      );
    }
  }