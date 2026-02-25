import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { logger } from '@shared/utils/logger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  const shutdown = async (): Promise<void> => {
    logger.info('uploader shutting down');
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((error) => {
  logger.error({ err: error }, 'failed to bootstrap uploader');
  process.exit(1);
});
