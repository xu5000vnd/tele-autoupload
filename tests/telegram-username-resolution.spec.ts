import { BadRequestException, HttpException, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import bigInt from 'big-integer';
import { Api } from 'telegram';
import { describe, expect, it, vi } from 'vitest';
import { MessagesService } from '../apps/stats-api/src/messages.service';
import {
  TelegramGateway,
  TelegramUsernameLookupUnavailableError,
  TelegramUsernameNotUserError,
} from '@shared/telegram/telegram-gateway';

describe('TelegramGateway username resolution', () => {
  it('resolves only a matching PeerUser through the existing request gate', async () => {
    const invoke = vi.fn().mockResolvedValue(new Api.contacts.ResolvedPeer({
      peer: new Api.PeerUser({ userId: bigInt('9007199254740993') }),
      chats: [],
      users: [new Api.User({ id: bigInt('9007199254740993') })],
    }));
    const gateway = new TelegramGateway(undefined as never);
    (gateway as any).client = { connected: true, invoke };

    await expect(gateway.resolvePublicUserUsername('alice')).resolves.toEqual({
      telegramUserId: 9007199254740993n,
    });

    const request = invoke.mock.calls[0][0];
    expect(request).toBeInstanceOf(Api.contacts.ResolveUsername);
    expect(request.username).toBe('alice');
  });

  it('rejects channel and group peers instead of returning an ID', async () => {
    const invoke = vi.fn().mockResolvedValue(new Api.contacts.ResolvedPeer({
      peer: new Api.PeerChannel({ channelId: bigInt(123) }),
      chats: [],
      users: [],
    }));
    const gateway = new TelegramGateway(undefined as never);
    (gateway as any).client = { connected: true, invoke };

    await expect(gateway.resolvePublicUserUsername('channel')).rejects.toBeInstanceOf(
      TelegramUsernameNotUserError,
    );
  });

  it('rejects an inconsistent PeerUser result without a matching user object', async () => {
    const invoke = vi.fn().mockResolvedValue(new Api.contacts.ResolvedPeer({
      peer: new Api.PeerUser({ userId: bigInt(42) }),
      chats: [],
      users: [new Api.User({ id: bigInt(41) })],
    }));
    const gateway = new TelegramGateway(undefined as never);
    (gateway as any).client = { connected: true, invoke };

    await expect(gateway.resolvePublicUserUsername('alice')).rejects.toBeInstanceOf(
      TelegramUsernameLookupUnavailableError,
    );
  });

  it('rejects bots even though Telegram represents them as PeerUser', async () => {
    const invoke = vi.fn().mockResolvedValue(new Api.contacts.ResolvedPeer({
      peer: new Api.PeerUser({ userId: bigInt(42) }),
      chats: [],
      users: [new Api.User({ id: bigInt(42), bot: true })],
    }));
    const gateway = new TelegramGateway(undefined as never);
    (gateway as any).client = { connected: true, invoke };

    await expect(gateway.resolvePublicUserUsername('a_bot')).rejects.toBeInstanceOf(
      TelegramUsernameNotUserError,
    );
  });

  it('resolves bots for internal identity checks', async () => {
    const invoke = vi.fn().mockResolvedValue(new Api.contacts.ResolvedPeer({
      peer: new Api.PeerUser({ userId: bigInt(42) }),
      chats: [],
      users: [new Api.User({ id: bigInt(42), bot: true })],
    }));
    const gateway = new TelegramGateway(undefined as never);
    (gateway as any).client = { connected: true, invoke };

    await expect(gateway.resolvePublicUserOrBotUsername('a_bot')).resolves.toEqual({
      telegramUserId: 42n,
      isBot: true,
    });
  });

  it('does not invoke Telegram when the shared client is disconnected', async () => {
    const invoke = vi.fn();
    const gateway = new TelegramGateway(undefined as never);
    (gateway as any).client = { connected: false, invoke };

    await expect(gateway.resolvePublicUserUsername('alice')).rejects.toBeInstanceOf(
      TelegramUsernameLookupUnavailableError,
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('MessagesService username resolution', () => {
  function createService(resolvePublicUserUsername: ReturnType<typeof vi.fn>): MessagesService {
    return new MessagesService(
      {} as never,
      { resolvePublicUserUsername } as never,
    );
  }

  it('normalizes the username and serializes an exact decimal string ID', async () => {
    const resolvePublicUserUsername = vi.fn().mockResolvedValue({ telegramUserId: 9007199254740993n });
    const service = createService(resolvePublicUserUsername);

    await expect(service.resolveTargetUsername(' @Alice ')).resolves.toEqual({
      telegram_username: 'alice',
      telegram_user_id: '9007199254740993',
    });
    expect(resolvePublicUserUsername).toHaveBeenCalledWith('alice');
  });

  it.each([
    [new TelegramUsernameNotUserError(), UnprocessableEntityException, 422, 'Telegram username does not belong to a user'],
    [Object.assign(new Error('USERNAME_INVALID'), { errorMessage: 'USERNAME_INVALID' }), BadRequestException, 400, 'Telegram username is invalid'],
    [Object.assign(new Error('USERNAME_NOT_OCCUPIED'), { errorMessage: 'USERNAME_NOT_OCCUPIED' }), NotFoundException, 404, 'Telegram username was not found'],
    [Object.assign(new Error('FLOOD_WAIT_7'), { errorMessage: 'FLOOD_WAIT_7' }), HttpException, 429, 'Telegram is rate limited; try again later'],
    [new TelegramUsernameLookupUnavailableError(), ServiceUnavailableException, 503, 'Telegram username lookup is currently unavailable'],
  ])('maps safe lookup failures', async (error, exceptionType, status, message) => {
    const service = createService(vi.fn().mockRejectedValue(error));

    await expect(service.resolveTargetUsername('alice')).rejects.toSatisfy((exception: unknown) => {
      if (!(exception instanceof HttpException) || !(exception instanceof exceptionType)) {
        return false;
      }
      const response = exception.getResponse();
      const responseMessage = typeof response === 'string' ? response : response.message;
      return exception.getStatus() === status && responseMessage === message;
    });
  });
});
