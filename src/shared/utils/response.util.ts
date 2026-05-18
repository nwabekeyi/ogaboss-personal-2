import { HttpStatus } from '@nestjs/common';

export interface SuccessResponse<T> {
  success: true;
  status: number;
  message: string;
  data: T;
  token?: string;
}

export interface ErrorResponse {
  success: false;
  status: number;
  message: string;
}

export interface ServerError {
  success: false;
  status: number;
  message: string;
  error?: Error;
}

export type ApiResponse<T> = SuccessResponse<T> | ErrorResponse | ServerError;

export function createSuccessResponse<T>(
  status: number = HttpStatus.OK,
  message: string,
  data: T,
  token?: string,
): SuccessResponse<T> {
  const response: SuccessResponse<T> = {
    success: true,
    status,
    message,
    data,
  };
  if (token !== undefined) {
    response.token = token;
  }
  return response;
}

export function createErrorResponse(
  message: string,
  status: number = HttpStatus.BAD_REQUEST,
): ErrorResponse {
  return {
    success: false,
    status,
    message,
  };
}

export function createServerError(
  message: string,
  error?: Error,
  status: number = HttpStatus.INTERNAL_SERVER_ERROR,
): ServerError {
  const response: ServerError = {
    success: false,
    status,
    message,
  };
  if (error !== undefined) {
    response.error = error;
  }
  return response;
}
