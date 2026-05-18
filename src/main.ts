import './instrument';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import helmet from 'helmet';
import {
  BadRequestException,
  Logger,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { Environment } from './common/enums/environment-variables.enum';
import {
  GlobalExceptionFilter,
  ResponseInterceptor,
  LoggingInterceptor,
} from './core';
import { createDocument } from './docs/swagger';
import { config, assertNoUndefined } from './config';

async function bootstrap() {
  // **Block app if any config value is undefined**
  assertNoUndefined(config);

  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
    bufferLogs: true,
    rawBody: true,
  });
  const logger = new Logger('Bootstrap');

  const port = config.port;
  const environment = config.env;

  app.use(helmet());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      disableErrorMessages: environment !== Environment.PRODUCTION,
      transform: true,
      forbidUnknownValues: true,
      skipMissingProperties: false,
      stopAtFirstError: false,
      validationError: {
        target: false,
        value: false,
      },
      exceptionFactory: (validationErrors: ValidationError[] = []) =>
        new BadRequestException(validationErrors, 'Bad Request'),
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter(logger));
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalInterceptors(new LoggingInterceptor());
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
  });

  (BigInt.prototype as any).toJSON = function () {
    return this.toString();
  };

  app.enableCors({
    // origin: getAllowedOrigins(environment),
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  createDocument(app);
  await app.listen(port);
  logger.log(`Application is running on: ${await app.getUrl()} ${environment}`);
}
bootstrap();
