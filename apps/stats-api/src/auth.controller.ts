import { Body, Controller, Post, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() body: Record<string, unknown>): Record<string, unknown> {
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!this.authService.validateCredentials(username, password)) {
      throw new UnauthorizedException('invalid username or password');
    }

    return {
      ok: true,
      token: this.authService.getToken(),
      username,
    };
  }
}
