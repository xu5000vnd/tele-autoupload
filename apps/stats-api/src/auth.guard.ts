import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

@Injectable()
export class BearerAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const authHeader = request.headers.authorization ?? '';

    if (!this.authService.isValidBearerToken(authHeader)) {
      throw new UnauthorizedException('invalid token');
    }

    return true;
  }
}
