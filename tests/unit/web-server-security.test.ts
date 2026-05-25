import { DEFAULT_WEB_HOST, isAllowedWebOrigin } from '../../src/web/server';

describe('web server origin security', () => {
  it('keeps localhost bindings permissive for the existing local workflow', () => {
    expect(isAllowedWebOrigin('https://example.test', '127.0.0.1:2281', DEFAULT_WEB_HOST)).toBe(true);
    expect(isAllowedWebOrigin('https://example.test', 'localhost:2281', 'localhost')).toBe(true);
    expect(isAllowedWebOrigin('https://example.test', '[::1]:2281', '::1')).toBe(true);
  });

  it('allows browser requests to remote bindings only from the served host', () => {
    expect(isAllowedWebOrigin('http://192.168.1.20:2281', '192.168.1.20:2281', '0.0.0.0')).toBe(true);
    expect(isAllowedWebOrigin('http://dashboard.example.test', 'dashboard.example.test', '0.0.0.0')).toBe(true);
    expect(isAllowedWebOrigin('http://192.168.1.20:2282', '192.168.1.20:2281', '0.0.0.0')).toBe(false);
    expect(isAllowedWebOrigin('http://evil.example.test', '192.168.1.20:2281', '0.0.0.0')).toBe(false);
  });

  it('allows missing origins but rejects malformed origins for remote bindings', () => {
    expect(isAllowedWebOrigin(undefined, '192.168.1.20:2281', '0.0.0.0')).toBe(true);
    expect(isAllowedWebOrigin('not a url', '192.168.1.20:2281', '0.0.0.0')).toBe(false);
    expect(isAllowedWebOrigin('http://192.168.1.20:2281', undefined, '0.0.0.0')).toBe(false);
  });
});
