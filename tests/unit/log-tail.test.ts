import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readLastLines, readLastLinesText } from '../../src/runtime/log-tail';

function createTempLogPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubkit-log-tail-test-'));
  return path.join(dir, 'module.log');
}

describe('log-tail', () => {
  it('reads only the requested trailing lines', async () => {
    const logPath = createTempLogPath();
    fs.writeFileSync(logPath, Array.from({ length: 20 }, (_, index) => `line-${index + 1}`).join('\n'), 'utf-8');

    await expect(readLastLines(logPath, 4)).resolves.toEqual([
      'line-17',
      'line-18',
      'line-19',
      'line-20',
    ]);
  });

  it('preserves blank lines for raw log text', async () => {
    const logPath = createTempLogPath();
    fs.writeFileSync(logPath, 'a\n\nb\nc\n', 'utf-8');

    await expect(readLastLinesText(logPath, 4)).resolves.toBe('a\n\nb\nc');
  });

  it('returns empty results when the log file does not exist', async () => {
    const logPath = path.join(os.tmpdir(), `hubkit-missing-${Date.now()}.log`);

    await expect(readLastLines(logPath, 20)).resolves.toEqual([]);
    await expect(readLastLinesText(logPath, 20)).resolves.toBe('');
  });
});
