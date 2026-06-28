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
});
