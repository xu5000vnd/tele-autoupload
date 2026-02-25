import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { appConfig } from '@shared/config/env';

@Injectable()
export class BearerAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    return true;
    if (!appConfig.statsApiAuthToken) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const authHeader = request.headers.authorization ?? '';
    if (authHeader !== `Bearer ${appConfig.statsApiAuthToken}`) {
      throw new UnauthorizedException('invalid token');
    }

    return true;
  }
}
