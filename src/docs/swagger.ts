import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import basicAuth from 'express-basic-auth';
import { ConfigService } from '@nestjs/config';
import { SWAGGER_CONFIG } from './swagger.config';

/**
 * Creates an OpenAPI document for an application, via swagger.
 * @param app the nestjs application
 * @returns the OpenAPI document
 */
const SWAGGER_ENVS = ['development', 'staging', 'production'];

export function createDocument(app: INestApplication) {
  const builder = new DocumentBuilder()
    .setTitle(SWAGGER_CONFIG.title)
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'Bearer',
    )
    .setDescription(SWAGGER_CONFIG.description)
    .setVersion(SWAGGER_CONFIG.version);
  for (const tag of SWAGGER_CONFIG.tags) {
    builder.addTag(tag);
  }
  const options = builder.build();
  const username = app.get(ConfigService).get<string>('DOC_USERNAME');
  const password = app.get(ConfigService).get<string>('DOC_PASSWORD');
  const env = app.get(ConfigService).get<string>('NODE_ENV');
  if (SWAGGER_ENVS.includes(env)) {
    app.use(
      '/api/docs',
      basicAuth({
        challenge: true,
        users: {
          [username]: password,
        },
      }),
    );
    const document = SwaggerModule.createDocument(app, options);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: {
        cacheControl: false,
      },
    });
  }
}
