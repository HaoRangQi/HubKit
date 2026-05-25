import * as fs from 'fs';
import * as path from 'path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf-8');
}

describe('log-search API wiring', () => {
  it('mounts log search routes from the main API router', () => {
    const source = readSource('src/web/api/routes.ts');

    expect(source).toContain("import { createLogSearchRouter } from './log-search-routes'");
    expect(source).toContain('router.use(createLogSearchRouter({ registry, scriptBundleManager, bootPreferenceService }))');
    expect(source).not.toContain("router.get('/log-search'");
    expect(source).not.toContain('collectScriptLogSearchSources(scriptBundleManager, lines)');
    expect(source).not.toContain('collectSystemLogSearchSources(bootPreferenceService, lines)');
  });

  it('collects module, script, and system action log sources in its own router module', () => {
    const source = readSource('src/web/api/log-search-routes.ts');

    expect(source).toContain("router.get('/log-search'");
    expect(source).toContain('const moduleSources = await Promise.all');
    expect(source).toContain('collectScriptLogSearchSources(scriptBundleManager, lines)');
    expect(source).toContain('collectSystemLogSearchSources(bootPreferenceService, lines)');
    expect(source).toContain('const sources = [...moduleSources, ...scriptSources, ...systemSources]');
  });
});
