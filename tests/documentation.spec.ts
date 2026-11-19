import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const read = (file: string): string => readFileSync(path.resolve(root, file), 'utf8');
const routing = (text: string): string | undefined =>
  text.match(/<!-- routing:start -->([\s\S]*?)<!-- routing:end -->/)?.[1].trim();
const prose = (text: string): string => text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
const normalize = (label: string): string => label.trim().replace(/\s+/g, ' ').toLowerCase();

it('keeps documentation links, routing tables and agent budgets valid', () => {
  const files = [...new Set(execFileSync('git', [
    'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '*.md',
  ], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))];
  const errors: string[] = [];
  expect(files.length).toBeGreaterThan(0);
  expect(routing(read('AGENTS.md'))).toBeDefined();
  expect(routing(read('.principles/README.md'))).toBeDefined();
  expect(routing(read('.principles/README.md'))).toBe(routing(read('AGENTS.md')));

  for (const file of files) {
    const text = read(file);
    const body = prose(text);
    const references = new Map([...body.matchAll(/^\[([^\]]+)\]:\s*(\S+)/gm)]
      .map((match) => [normalize(match[1]), match[2]]));
    const destinations = [...body.matchAll(/\[[^\]\n]+\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)]
      .map((match) => match[1].replace(/^<|>$/g, ''));
    destinations.push(...references.values());
    for (const match of body.matchAll(/\[([^\]\n]+)\]\[([^\]\n]*)\]/g)) {
      if (!references.has(normalize(match[2] || match[1]))) {
        errors.push(`${file}: undefined reference ${match[2] || match[1]}`);
      }
    }
    if (path.basename(file) === 'CLAUDE.md') {
      expect(text.trim(), file).toBe('@AGENTS.md');
      destinations.push('AGENTS.md');
    }
    if (['AGENTS.md', 'CLAUDE.md'].includes(path.basename(file))) {
      const budget = path.dirname(file) === '.' ? 150 : 300;
      expect(text.trimEnd().split(/\r?\n/).length, file).toBeLessThanOrEqual(budget);
    }
    for (const destination of destinations) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(destination)) continue;
      const [relative, fragment] = destination.split('#').map(decodeURIComponent);
      const target = relative ? path.resolve(root, path.dirname(file), relative) : path.resolve(root, file);
      if (!existsSync(target)) {
        errors.push(`${file}: missing ${destination}`);
        continue;
      }
      if (!fragment) continue;
      const content = readFileSync(target, 'utf8');
      if (/^L\d+(?:-L\d+)?$/.test(fragment)) {
        if (fragment.match(/\d+/g)!.some((line) => Number(line) < 1 || Number(line) > content.split('\n').length)) {
          errors.push(`${file}: invalid source line ${destination}`);
        }
      } else {
        const seen = new Map<string, number>();
        const anchors = [...prose(content).matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)].map((match) => {
          const slug = match[1].toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').replace(/\s/g, '-');
          const count = seen.get(slug) ?? 0;
          seen.set(slug, count + 1);
          return count ? `${slug}-${count}` : slug;
        });
        if (!anchors.includes(fragment)) errors.push(`${file}: missing anchor ${destination}`);
      }
    }
  }
  expect(errors).toEqual([]);
});
