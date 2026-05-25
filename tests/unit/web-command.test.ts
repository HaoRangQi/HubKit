import { parseWebHost, parseWebPort } from '../../src/cli/commands/web';
import { DEFAULT_WEB_HOST } from '../../src/web/server';

describe('web command options', () => {
  it('defaults to localhost-only binding', () => {
    expect(parseWebHost(undefined)).toBe(DEFAULT_WEB_HOST);
    expect(DEFAULT_WEB_HOST).toBe('127.0.0.1');
  });

  it('accepts explicit remote binding hosts', () => {
    expect(parseWebHost('0.0.0.0')).toBe('0.0.0.0');
    expect(parseWebHost('192.168.1.10')).toBe('192.168.1.10');
    expect(parseWebHost('localhost')).toBe('localhost');
  });

  it('rejects malformed host values', () => {
    expect(() => parseWebHost('')).toThrow('--host');
    expect(() => parseWebHost('bad host')).toThrow('--host');
    expect(() => parseWebHost('http://localhost')).toThrow('--host');
    expect(() => parseWebHost('..\\bad')).toThrow('--host');
  });

  it('parses valid web ports', () => {
    expect(parseWebPort('1')).toBe(1);
    expect(parseWebPort('2281')).toBe(2281);
    expect(parseWebPort('65535')).toBe(65535);
  });

  it('rejects invalid web ports', () => {
    expect(() => parseWebPort('0')).toThrow('--port');
    expect(() => parseWebPort('65536')).toThrow('--port');
    expect(() => parseWebPort('2281abc')).toThrow('--port');
    expect(() => parseWebPort('')).toThrow('--port');
  });
});
