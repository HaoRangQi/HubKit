import { config } from '../../config/config';
import { ModuleRegistry } from '../../registry/module-registry';
import { ModuleScanner } from '../../registry/module-scanner';

export interface ScanAndRegisterModulesDependencies {
  scanner?: Pick<ModuleScanner, 'scan'>;
  getModuleDirs?: () => string[];
}

export async function scanAndRegisterModules(
  registry: ModuleRegistry,
  dependencies: ScanAndRegisterModulesDependencies = {},
): Promise<void> {
  const scanner = dependencies.scanner || new ModuleScanner();
  const getModuleDirs = dependencies.getModuleDirs || (() => config.getModuleDirs());

  for (const dir of getModuleDirs()) {
    const modules = await scanner.scan(dir);
    modules.forEach((module) => registry.register(module));
  }
}
