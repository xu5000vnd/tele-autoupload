import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { MessagesController } from '../apps/stats-api/src/messages.controller';

describe('MessagesController target parsing', () => {
  it('lowercases telegram_username when creating a target', async () => {
    const service = {
      createTarget: vi.fn().mockResolvedValue({}),
    };
    const controller = new MessagesController(service as any);

    await controller.createTarget({
      tu_id: '170501375',
      tu_name: 'Juliet Pius',
      telegram_user_id: '0',
      telegram_chat_id: '-1004419214714',
      telegram_username: ' @Juliegjdaniels ',
    });

    expect(service.createTarget).toHaveBeenCalledWith(expect.objectContaining({
      username: 'juliegjdaniels',
    }));
  });

  it('lowercases telegram_username when updating a target', async () => {
    const service = {
      updateTarget: vi.fn().mockResolvedValue({}),
    };
    const controller = new MessagesController(service as any);

    await controller.updateTarget('12', {
      telegram_username: '@Juliegjdaniels',
    });

    expect(service.updateTarget).toHaveBeenCalledWith(12, expect.objectContaining({
      username: 'juliegjdaniels',
    }));
  });

  it('normalizes a username-only resolver request without target fields', async () => {
    const service = {
      resolveTargetUsername: vi.fn().mockResolvedValue({
        telegram_username: 'alice',
        telegram_user_id: '9007199254740993',
      }),
    };
    const controller = new MessagesController(service as any);

    await expect(controller.resolveTargetUsername({ telegram_username: ' @Alice ' })).resolves.toEqual({
      telegram_username: 'alice',
      telegram_user_id: '9007199254740993',
    });

    expect(service.resolveTargetUsername).toHaveBeenCalledWith('alice');
  });

  it.each([
    [{}, 'telegram_username is required'],
    [null, 'telegram_username is required'],
    [{ telegram_username: '   @@@  ' }, 'telegram_username is required'],
    [{ telegram_username: 123 }, 'telegram_username must be a string'],
  ])('rejects invalid resolver input', async (body, message) => {
    const service = { resolveTargetUsername: vi.fn() };
    const controller = new MessagesController(service as any);

    await expect(controller.resolveTargetUsername(body as any)).rejects.toMatchObject(
      new BadRequestException(message),
    );
    expect(service.resolveTargetUsername).not.toHaveBeenCalled();
  });
});
