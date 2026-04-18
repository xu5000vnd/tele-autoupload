import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { appConfig } from '@shared/config/env';

@Injectable()
export class AuthService {
  isConfigured(): boolean {
    return Boolean(
      appConfig.adminWebUsername.trim() &&
      appConfig.adminWebPassword.trim() &&
      appConfig.statsApiAuthToken.trim(),
    );
  }

  assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'admin auth is not configured (set ADMIN_WEB_USERNAME, ADMIN_WEB_PASSWORD, STATS_API_AUTH_TOKEN)',
      );
    }
  }

  validateCredentials(username: string, password: string): boolean {
    this.assertConfigured();
    return (
      username === appConfig.adminWebUsername &&
      password === appConfig.adminWebPassword
    );
  }

  getToken(): string {
    this.assertConfigured();
    return appConfig.statsApiAuthToken;
  }

  isValidBearerToken(authHeader?: string): boolean {
    this.assertConfigured();
    return authHeader === `Bearer ${appConfig.statsApiAuthToken}`;
  }
}
