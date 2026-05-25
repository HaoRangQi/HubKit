import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import {
  createModuleConfigTemplate,
  ModuleType,
  validateModuleConfig,
} from '../../registry/module-config';

export interface InitModuleOptions {
  id?: string;
  name?: string;
  type?: ModuleType;
  script?: string;
  description?: string;
  webPort?: string;
  webUrl?: string;
  force?: boolean;
  dryRun?: boolean;
}

/**
 * init-module 命令 - 为现有项目生成 HubKit 模块配置
 */
export function registerInitModuleCommand(program: Command): void {
  program
    .command('init-module [directory]')
    .description('为现有项目生成 .hubkit.json 模块配置')
    .option('--id <id>', '模块 ID，默认由目录名推断')
    .option('--name <name>', '模块名称，默认由 package.json name 或目录名推断')
    .option('--type <type>', '模块类型 (nodejs|python|shell)')
    .option('--script <path>', '入口脚本路径，默认自动探测')
    .option('--description <text>', '模块描述')
    .option('--web-port <port>', '模块 Web 端口')
    .option('--web-url <url>', '模块 Web 入口 URL')
    .option('--force', '覆盖已有 .hubkit.json')
    .option('--dry-run', '只预览生成结果，不写入文件')
    .action((directory = '.', options: InitModuleOptions) => {
      try {
        const moduleDir = path.resolve(directory);
        if (!fs.existsSync(moduleDir) || !fs.statSync(moduleDir).isDirectory()) {
          throw new Error(`目录不存在: ${moduleDir}`);
        }

        const configPath = path.join(moduleDir, '.hubkit.json');
        if (fs.existsSync(configPath) && !options.force && !options.dryRun) {
          throw new Error(`已存在 .hubkit.json。如需覆盖，请使用 --force: ${configPath}`);
        }

        const inferred = inferModuleConfig(moduleDir, options);
        const validation = validateModuleConfig(inferred);
        if (!validation.valid) {
          console.error('生成的模块配置未通过校验:');
          validation.errors.forEach((issue) => console.error(`  - ${issue.field}: ${issue.message}`));
          process.exit(1);
        }

        const content = `${JSON.stringify(inferred, null, 2)}\n`;
        if (options.dryRun) {
          console.log(content);
        } else {
          fs.writeFileSync(configPath, content, 'utf-8');
          console.log(`已生成模块配置: ${configPath}`);
        }

        if (validation.warnings.length > 0) {
          console.log('\n配置建议:');
          validation.warnings.forEach((issue) => console.log(`  - ${issue.field}: ${issue.message}`));
        }

        console.log('\n下一步:');
        console.log('  1. 检查 .hubkit.json 中的 scriptPath、webPort 和描述。');
        console.log('  2. 确保该目录位于 HubKit moduleDirs 中，或把目录加入 ~/.hubkit/config.json。');
        console.log('  3. 运行 hub list 确认模块可被发现。');
      } catch (error) {
        console.error('初始化模块失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}

export function inferModuleConfig(moduleDir: string, options: InitModuleOptions) {
  const packageJson = readPackageJson(moduleDir);
  const dirName = path.basename(moduleDir);
  const type = options.type || inferModuleType(moduleDir);
  const scriptPath = options.script || inferScriptPath(moduleDir, type);
  const webPort = parseWebPort(options.webPort);

  return createModuleConfigTemplate({
    id: options.id || slugify(packageJson?.name || dirName),
    name: options.name || packageJson?.name || titleize(dirName),
    description: options.description || packageJson?.description || '',
    type,
    scriptPath,
    webPort,
    webUrl: options.webUrl,
  });
}

export function parseWebPort(value?: string): number | undefined {
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('--web-port 必须是 1 到 65535 之间的整数');
  }
  return port;
}

function readPackageJson(moduleDir: string): { name?: string; description?: string; scripts?: Record<string, string> } | null {
  const packagePath = path.join(moduleDir, 'package.json');
  if (!fs.existsSync(packagePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
  } catch {
    return null;
  }
}

function inferModuleType(moduleDir: string): ModuleType {
  if (fs.existsSync(path.join(moduleDir, 'package.json'))) return 'nodejs';
  if (fs.existsSync(path.join(moduleDir, 'main.py')) || fs.existsSync(path.join(moduleDir, 'requirements.txt'))) return 'python';
  return 'shell';
}

function inferScriptPath(moduleDir: string, type: ModuleType): string {
  const candidatesByType: Record<ModuleType, string[]> = {
    nodejs: ['index.js', 'server.js', 'src/index.js', 'src/server.js'],
    python: ['main.py', 'app.py', 'src/main.py'],
    shell: ['run.sh', 'start.sh', 'main.sh', 'worker.sh'],
  };

  const found = candidatesByType[type].find((candidate) => fs.existsSync(path.join(moduleDir, candidate)));
  if (found) return found;
  if (type === 'nodejs' && fs.existsSync(path.join(moduleDir, 'package.json'))) return '.';
  return candidatesByType[type][0];
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/\//g, '-')
    .replace(/[^a-z0-9-_.]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'module';
}

function titleize(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
