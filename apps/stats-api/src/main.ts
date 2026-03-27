import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { appConfig } from '@shared/config/env';
import { logger } from '@shared/utils/logger';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 100 * 1024 * 1024 }),
    { logger: false },
  );
  await app.listen({ port: appConfig.statsApiPort, host: '0.0.0.0' });
  logger.info({ port: appConfig.statsApiPort }, 'stats api started');
}

bootstrap().catch((error) => {
  logger.error({ err: error }, 'failed to bootstrap stats api');
  process.exit(1);
});
