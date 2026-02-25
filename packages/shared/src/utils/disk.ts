import { promises as fs } from 'node:fs';
import path from 'node:path';

async function dirSizeBytes(root: string): Promise<number> {
  let total = 0;
  const entries = await fs.readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      total += await dirSizeBytes(full);
      continue;
    }
    if (entry.isFile()) {
      const stat = await fs.stat(full);
      total += stat.size;
    }
  }

  return total;
}

export async function stagingUsage(input: {
  stagingDir: string;
  maxGb: number;
}): Promise<{ usedBytes: number; usedGb: number; usedPct: number }> {
  await fs.mkdir(input.stagingDir, { recursive: true });
  const usedBytes = await dirSizeBytes(input.stagingDir);
  const usedGb = usedBytes / (1024 ** 3);
  const usedPct = (usedGb / input.maxGb) * 100;
  return { usedBytes, usedGb, usedPct };
}
