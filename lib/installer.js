import fs from 'node:fs';
import path from 'node:path';
import { hash, relative, readRegular, stat, checkParents, sourceTree, transaction } from './files.js';

export const tools = ['codex', 'claude', 'copilot'];
export const skillDirectory = tool => ({ codex: '.agents/skills', claude: '.claude/skills', copilot: '.github/skills' })[tool];
export const agentFile = (id, tool) => ({ codex: `.codex/agents/sprite-${id}.toml`, claude: `.claude/agents/sprite-${id}.md`, copilot: `.github/agents/sprite-${id}.agent.md` })[tool];
const stateFile = (id, tool) => `.sprite/installations/${id}.${tool}.json`;
const identifier = value => typeof value === 'string' && /^[a-z][a-z0-9-]*$/.test(value);
const belongsToPackage = (cfg, id) => identifier(id) && (id === `sprite-${cfg.id}` || id.startsWith(`sprite-${cfg.id}-`));
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function keys(value, expected) { return object(value) && Object.keys(value).every(key => expected.includes(key)) && expected.every(key => Object.hasOwn(value, key)); }
export function manifest(root) {
  const source = readRegular(path.join(root, 'package.json'));
  if (!source) throw new Error('缺少 package.json');
  const pkg = JSON.parse(source.data.toString());
  const cfg = pkg.sprite;
  if (!object(cfg) || !identifier(cfg.id) || typeof cfg.role !== 'boolean' || !Array.isArray(cfg.practices) || !Array.isArray(cfg.baseSkills) || typeof pkg.version !== 'string' || !pkg.version) throw new Error('包的 sprite 配置无效');
  const skills = [...cfg.practices, ...cfg.baseSkills];
  if (new Set(skills).size !== skills.length || skills.some(id => !belongsToPackage(cfg, id))) throw new Error('Skill 名称必须唯一并属于本包');
  return { ...cfg, version: pkg.version };
}
export function parseArgs(args) {
  const result = { command: args[0] ?? 'help', target: process.cwd() };
  if (['--help', '-h', 'help'].includes(result.command)) return { command: 'help' };
  if (!['init', 'update', 'remove', 'preview'].includes(result.command)) throw new Error(`未知命令：${result.command}`);
  let target = false;
  const seen = new Set();
  for (let i = 1; i < args.length; i++) {
    const item = args[i];
    if (['--tool', '--practices'].includes(item)) {
      if (seen.has(item)) throw new Error(`重复参数：${item}`);
      seen.add(item);
      const value = args[++i];
      if (!value || value.startsWith('-')) throw new Error(`参数缺少值：${item}`);
      result[item.slice(2)] = value;
    } else if (['--skills-only', '--role'].includes(item)) {
      if (seen.has(item)) throw new Error(`重复参数：${item}`);
      seen.add(item);
      result[item === '--role' ? 'roleOnly' : 'skillsOnly'] = true;
    } else if (item === '--help' || item === '-h') return { command: 'help' };
    else if (item.startsWith('-')) throw new Error(`未知参数：${item}`);
    else if (target) throw new Error('只能指定一个目标目录');
    else { target = true; result.target = path.resolve(item); }
  }
  if (result.tool && !tools.includes(result.tool)) throw new Error(`工具只能选择：${tools.join(', ')}`);
  if (result.roleOnly && (result.practices !== undefined || result.skillsOnly)) throw new Error('--role 不能与 --practices 或 --skills-only 一起使用');
  if (result.command === 'remove' && (result.practices === undefined || result.roleOnly || result.skillsOnly)) throw new Error('remove 必须用 --practices 明确指定要移除的实践');
  if (result.command === 'update' && result.skillsOnly) throw new Error('update 请用 --practices 指定实践');
  return result;
}
export function installedTools(target, cfg) {
  return tools.filter(tool => stat(path.join(target, stateFile(cfg.id, tool))) !== null);
}
function allowedFile(cfg, tool, component, file) {
  relative(file);
  if (component === 'role') return cfg.role && file === agentFile(cfg.id, tool);
  const id = component.startsWith('skill:') ? component.slice(6) : '';
  return belongsToPackage(cfg, id) && file.startsWith(`${skillDirectory(tool)}/${id}/`);
}
export function readState(target, cfg, tool, identities) {
  const source = readRegular(path.join(target, stateFile(cfg.id, tool)), identities);
  if (!source) return { state: null, source: null };
  let value;
  try { value = JSON.parse(source.data.toString()); } catch { throw new Error('安装记录不是有效 JSON；请保留备份后检查本包记录'); }
  const invalid = () => { throw new Error(`本包安装记录不受支持或已损坏：${stateFile(cfg.id, tool)}。先备份本包记录和生成文件，再按 README 恢复；不会迁移或接管文件。`); };
  if (!keys(value, ['formatVersion', 'package', 'tool', 'version', 'components']) || value.formatVersion !== 1 || value.package !== cfg.id || value.tool !== tool || typeof value.version !== 'string' || !object(value.components)) invalid();
  const paths = new Set();
  for (const [component, entry] of Object.entries(value.components)) {
    if (!keys(entry, ['version', 'files']) || typeof entry.version !== 'string' || !object(entry.files) || Object.keys(entry.files).length === 0) invalid();
    if (component !== 'role' && !(component.startsWith('skill:') && belongsToPackage(cfg, component.slice(6)))) invalid();
    for (const [file, digest] of Object.entries(entry.files)) {
      if (!allowedFile(cfg, tool, component, file) || paths.has(file) || typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) invalid();
      paths.add(file);
    }
    if (component === 'role' && (!cfg.role || Object.keys(entry.files).length !== 1)) invalid();
  }
  return { state: value, source };
}
function selectedPractices(cfg, option, state, command) {
  if (option === undefined || option === 'none') return [];
  // Retired practices remain owned by their original component. Keeping their
  // record does not adopt new files or make them available to a fresh install.
  const historical = command === 'init' ? [] : Object.keys(state?.components ?? {}).filter(key => key.startsWith('skill:')).map(key => key.slice(6)).filter(id => !cfg.baseSkills.includes(id));
  const available = [...new Set([...cfg.practices, ...historical])];
  if (option === 'all') return command === 'remove' ? available : [...cfg.practices];
  const list = option.split(',');
  if (new Set(list).size !== list.length || list.some(id => !available.includes(id))) throw new Error(`实践无效；可选：${available.join(', ') || '无'}，none，all`);
  return list;
}
function select(cfg, options, state) {
  const practices = selectedPractices(cfg, options.practices, state, options.command);
  if (options.roleOnly && !cfg.role) throw new Error('本包没有角色');
  if (options.command === 'remove') {
    if (!practices.length) throw new Error('没有指定要移除的实践');
    return practices.map(id => `skill:${id}`);
  }
  if (options.command === 'update' || (options.command === 'preview' && state && !options.skillsOnly)) {
    const selected = options.roleOnly ? ['role'] : options.practices !== undefined ? practices.map(id => `skill:${id}`) : Object.keys(state?.components ?? {});
    if (!selected.length) throw new Error('没有选中已安装组件；请先 init');
    return selected;
  }
  const selected = [...(cfg.role && !options.skillsOnly ? ['role'] : []), ...cfg.baseSkills.map(id => `skill:${id}`), ...practices.map(id => `skill:${id}`)];
  if (!selected.length) throw new Error('没有选中组件；--skills-only 需要用 --practices 选择实践');
  return selected;
}
function generated(root, cfg, tool, component, renderRole) {
  if (component === 'role') {
    const source = readRegular(path.join(root, 'templates/agent.md'));
    if (!source) throw new Error('缺少 templates/agent.md');
    return new Map([[agentFile(cfg.id, tool), Buffer.from(renderRole(cfg.id, source.data.toString(), tool))]]);
  }
  const id = component.slice(6);
  if (![...cfg.practices, ...cfg.baseSkills].includes(id)) throw new Error(`当前包已不提供实践：${id}。现有内容保持原样；可用仍提供该实践的包版本维护，或用 remove --practices ${id} 明确移除。`);
  const tree = sourceTree(path.join(root, 'skills', id));
  if (!tree.has('SKILL.md')) throw new Error(`Skill 缺少入口：${id}/SKILL.md`);
  return new Map([...tree].map(([file, data]) => [`${skillDirectory(tool)}/${id}/${file}`, data]));
}
export function operate({ root, cfg, options, renderRole, hooks }) {
  const { target, tool, command } = options;
  checkParents(path.join(target, '_'));
  const metadata = path.join(target, stateFile(cfg.id, tool));
  const messages = [];
  const build = identities => {
    const { state, source } = readState(target, cfg, tool, identities);
    const guards = new Map([[metadata, source]]);
    const observe = file => {
      const snapshot = readRegular(file, identities);
      guards.set(file, snapshot);
      return snapshot;
    };
    if (['update', 'remove'].includes(command) && !state) throw new Error('本包尚未在此工具安装；请先 init');
    const components = select(cfg, options, state);
    const next = state ? structuredClone(state) : { formatVersion: 1, package: cfg.id, tool, version: cfg.version, components: {} };
    const operations = [];
    const conflicts = [];
    for (const component of components) {
      const old = state?.components[component];
      if (['update', 'remove'].includes(command) && !old) { conflicts.push(`${component} 尚未安装；使用 init 追加`); continue; }
      const output = command === 'remove' ? new Map() : generated(root, cfg, tool, component, renderRole);
      if (command === 'preview') {
        messages.push({ component, version: cfg.version, files: [...output].map(([file, data]) => ({ path: file, content: data.toString('utf8') })), wouldRemove: Object.keys(old?.files ?? {}).filter(file => !output.has(file)) });
        continue;
      }
      if (command === 'init' && old) {
        for (const [file, digest] of Object.entries(old.files)) {
          try { if (observe(path.join(target, file))?.hash !== digest) conflicts.push(`${file}：已有组件已修改或文件缺失`); }
          catch (error) { conflicts.push(error.message); }
        }
        messages.push({ component, status: '已存在，保留原版本', files: Object.keys(old.files) });
        continue;
      }
      for (const file of new Set([...Object.keys(old?.files ?? {}), ...output.keys()])) {
        try {
          const before = observe(path.join(target, file));
          const expected = old?.files[file] ?? null;
          if (expected === null ? before !== null : before?.hash !== expected) { conflicts.push(`${file}：已有无归属文件、用户修改或文件缺失`); continue; }
          const data = output.get(file) ?? null;
          if (data === null || before?.hash !== hash(data)) operations.push({ file: path.join(target, file), expected, data });
        } catch (error) { conflicts.push(error.message); }
      }
      if (command === 'remove') delete next.components[component];
      else next.components[component] = { version: cfg.version, files: Object.fromEntries([...output].map(([file, data]) => [file, hash(data)])) };
      messages.push({ component, status: command === 'remove' ? '已移除' : old ? '已核对更新' : '新增', files: [...new Set([...Object.keys(old?.files ?? {}), ...output.keys()])] });
    }
    if (conflicts.length) throw new Error(`本次未写入选定内容。冲突：\n${conflicts.join('\n')}\n可运行 preview 查看新版内容后手动比较。`);
    if (command === 'preview') return { operations: [], guards };
    next.version = cfg.version;
    // Idempotent init does not rewrite an existing record merely because a new
    // package version is available. Component versions remain authoritative.
    if (command === 'init' && state && JSON.stringify(next.components) === JSON.stringify(state.components)) return { operations, guards };
    const data = Buffer.from(`${JSON.stringify(next, null, 2)}\n`);
    if (source?.hash !== hash(data)) operations.push({ file: metadata, expected: source?.hash ?? null, data });
    return { operations, guards };
  };
  if (command === 'preview') { build(new Map()); return { target, tool, preview: messages }; }
  const result = transaction({ lockFile: `${metadata}.lock`, metadataFile: metadata, build, hooks });
  return { target, tool, components: messages, backupFiles: result.backupFiles };
}

export function detectProject(target) {
  const evidence = [];
  const read = file => {
    try {
      const full = path.join(target, file);
      const info = stat(full);
      if (!info) return null;
      if (info.size > 1024 * 1024) { evidence.push({ path: file, signal: '文件较大，跳过读取' }); return null; }
      return readRegular(full)?.data.toString('utf8') ?? null;
    } catch { evidence.push({ path: file, signal: '无法安全读取，已跳过' }); return null; }
  };
  const packageText = read('package.json');
  if (packageText !== null) {
    const signals = ['Node.js 项目清单'];
    try {
      const pkg = JSON.parse(packageText);
      const dependencies = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      for (const name of ['react', 'vite', 'typescript', 'tailwindcss', 'antd', '@mui/material', '@nestjs/core', 'express', 'fastify']) if (Object.hasOwn(dependencies, name)) signals.push(name);
      const scripts = ['build', 'lint', 'test', 'typecheck'].filter(name => object(pkg.scripts) && Object.hasOwn(pkg.scripts, name));
      if (scripts.length) signals.push(`检查入口：${scripts.join(', ')}`);
    } catch { signals.push('无法解析，安装可继续'); }
    evidence.push({ path: 'package.json', signal: signals.join('；') });
  }
  for (const [file, signal] of [['tsconfig.json', 'TypeScript 配置'], ['components.json', '界面组件配置'], ['pnpm-lock.yaml', 'pnpm 锁文件'], ['yarn.lock', 'Yarn 锁文件'], ['package-lock.json', 'npm 锁文件'], ['pom.xml', 'Maven 构建'], ['build.gradle', 'Gradle 构建'], ['build.gradle.kts', 'Gradle 构建'], ['mvnw', 'Maven 包装入口'], ['gradlew', 'Gradle 包装入口'], ['pyproject.toml', 'Python 项目清单'], ['requirements.txt', 'Python 依赖清单']]) if (read(file) !== null) evidence.push({ path: file, signal });
  return evidence;
}
