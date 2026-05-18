import {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
  Injectable,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Response<T> {
  status: string;
  statusCode: number;
  message: string;
  data: T;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, Response<T>> {
  constructor(private defaultMessage: string = 'Operation successful') {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<Response<T>> {
    return next.handle().pipe(
      map((responseData) => {
        const statusCode = context.switchToHttp().getResponse().statusCode;
        const { message, data } = this.extractMessageAndData(responseData);
        return {
          status: 'success',
          statusCode,
          message: message || this.defaultMessage,
          data,
        };
      }),
    );
  }

  private extractMessageAndData(responseData: any): {
    message?: string;
    data: T;
  } {
    if (responseData && typeof responseData === 'object') {
      if ('message' in responseData && 'data' in responseData) {
        // If the service returns both message and data
        return {
          message: responseData.message,
          data: responseData.data,
        };
      } else if ('message' in responseData) {
        // If the service returns only a message, treat the rest as data
        const { message, ...data } = responseData;
        return { message, data: data as T };
      }
    }
    // If no message is provided, return the entire response as data
    return { data: responseData };
  }
}
