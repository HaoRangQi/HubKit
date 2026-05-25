import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { rotateLogIfNeeded } from '../../src/runtime/log-rotation';

function createTempLogPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubkit-log-rotation-test-'));
  return path.join(dir, 'module.log');
}

describe('rotateLogIfNeeded', () => {
  it('does not rotate logs below the size limit', async () => {
    const logPath = createTempLogPath();
    fs.writeFileSync(logPath, 'small log', 'utf-8');

    await expect(rotateLogIfNeeded(logPath, { maxBytes: 100, maxFiles: 3 })).resolves.toBe(false);

    expect(fs.readFileSync(logPath, 'utf-8')).toBe('small log');
    expect(fs.existsSync(`${logPath}.1`)).toBe(false);
  });

  it('rotates the active log and shifts older rotations', async () => {
    const logPath = createTempLogPath();
    fs.writeFileSync(logPath, 'active log exceeds limit', 'utf-8');
    fs.writeFileSync(`${logPath}.1`, 'previous one', 'utf-8');
    fs.writeFileSync(`${logPath}.2`, 'previous two', 'utf-8');

    await expect(rotateLogIfNeeded(logPath, { maxBytes: 5, maxFiles: 3 })).resolves.toBe(true);

    expect(fs.readFileSync(logPath, 'utf-8')).toBe('');
    expect(fs.readFileSync(`${logPath}.1`, 'utf-8')).toBe('active log exceeds limit');
    expect(fs.readFileSync(`${logPath}.2`, 'utf-8')).toBe('previous one');
    expect(fs.readFileSync(`${logPath}.3`, 'utf-8')).toBe('previous two');
  });

  it('removes rotations beyond the retention limit', async () => {
    const logPath = createTempLogPath();
    fs.writeFileSync(logPath, 'active log exceeds limit', 'utf-8');
    fs.writeFileSync(`${logPath}.1`, 'previous one', 'utf-8');
    fs.writeFileSync(`${logPath}.2`, 'previous two', 'utf-8');

    await rotateLogIfNeeded(logPath, { maxBytes: 5, maxFiles: 2 });

    expect(fs.readFileSync(`${logPath}.1`, 'utf-8')).toBe('active log exceeds limit');
    expect(fs.readFileSync(`${logPath}.2`, 'utf-8')).toBe('previous one');
    expect(fs.existsSync(`${logPath}.3`)).toBe(false);
  });

  it('ignores missing log files', async () => {
    const logPath = path.join(os.tmpdir(), `hubkit-missing-${Date.now()}.log`);

    await expect(rotateLogIfNeeded(logPath, { maxBytes: 5, maxFiles: 2 })).resolves.toBe(false);
  });
});
