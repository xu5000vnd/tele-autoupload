import { describe, expect, it, vi } from 'vitest';
import { TelegramRequestGate } from '@shared/telegram/telegram-gateway';

describe('TelegramRequestGate', () => {
  it('shares FloodWait backoff with the distributed coordinator before releasing its permit', async () => {
    const permit = { token: 'request-permit', ttlMs: 1_000 };
    const coordinator = {
      acquireTelegramRequestPermit: vi.fn().mockResolvedValue(permit),
      renewTelegramRequestPermit: vi.fn().mockResolvedValue(true),
      releaseTelegramRequestPermit: vi.fn().mockResolvedValue(undefined),
      deferTelegramRequests: vi.fn().mockResolvedValue(undefined),
    };
    const gate = new TelegramRequestGate(1, 1_000, coordinator);
    const floodWait = Object.assign(new Error('FLOOD_WAIT_7'), {
      errorMessage: 'FLOOD_WAIT_7',
    });

    await expect(gate.run(async () => {
      throw floodWait;
    })).rejects.toBe(floodWait);

    expect(coordinator.acquireTelegramRequestPermit).toHaveBeenCalledOnce();
    expect(coordinator.deferTelegramRequests).toHaveBeenCalledWith(7_000);
    expect(coordinator.releaseTelegramRequestPermit).toHaveBeenCalledWith(permit);
  });

  it('does not enter the local or distributed gate after a reconciliation deadline', async () => {
    const coordinator = {
      acquireTelegramRequestPermit: vi.fn(),
      renewTelegramRequestPermit: vi.fn(),
      releaseTelegramRequestPermit: vi.fn(),
      deferTelegramRequests: vi.fn(),
    };
    const gate = new TelegramRequestGate(1, 1_000, coordinator);

    await expect(gate.run(async () => undefined, Date.now() - 1))
      .rejects.toThrow('Telegram request deadline exceeded');

    expect(coordinator.acquireTelegramRequestPermit).not.toHaveBeenCalled();
  });
});
