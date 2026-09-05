#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { manifest, parseArgs, installedTools, tools, operate, detectProject } from '../lib/installer.js';

// Tool-specific role rendering stays here; each role has one Markdown source.
export function renderRole(id, source, tool) {
  const description = source.split(/\r?\n/).map(line => line.trim()).find(line => line && !line.startsWith('#'));
  if (!description) throw new Error('角色主源需要一段简短说明');
  const name = `sprite-${id}`;
  if (tool === 'codex') return `name = ${JSON.stringify(name)}\ndescription = ${JSON.stringify(description)}\ndeveloper_instructions = ${JSON.stringify(source.trim())}\n`;
  return `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n\n${source.trim()}\n`;
}
export function help(cfg) {
  const bin = cfg.id === 'artifact-bridge' ? 'sprite-install-artifact-bridge' : `sprite-${cfg.id}`;
  return `${bin} — 独立安装与安全更新\n\n用法：\n  ${bin} init [target] --tool codex|claude|copilot [--practices none|all|完整名称,完整名称] [--skills-only]\n  ${bin} update [target] [--tool 工具] [--role | --practices 完整名称,完整名称]\n  ${bin} remove [target] [--tool 工具] --practices 完整名称,完整名称\n  ${bin} preview [target] --tool 工具 [--role | --practices 完整名称,完整名称] [--skills-only]\n\n角色默认不附带实践；桥接默认安装自己的 Skill 与读取工具。\n重复 init 保留已安装内容；update 只更新本包已安装的选定组件。\npreview 输出新版内容 JSON，不写文件；默认预览已有组件，未安装时按 init 默认选择。\n工具缺省时复用本包唯一安装记录；多工具时必须明确选择。\n可选实践：${cfg.practices.join(', ') || '无'}\n`;
}
export async function run({ root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), argv = process.argv.slice(2), output = text => process.stdout.write(text), input = process.stdin, terminalOutput = process.stdout, hooks } = {}) {
  const cfg = manifest(root);
  const options = parseArgs(argv);
  if (options.command === 'help') { output(help(cfg)); return { help: true }; }
  if (!options.tool) {
    const existing = installedTools(options.target, cfg);
    if (existing.length === 1) options.tool = existing[0];
    else if (input.isTTY && terminalOutput.isTTY) {
      const prompt = createInterface({ input, output: terminalOutput });
      try { options.tool = (await prompt.question(`选择工具 (${tools.join('/')})：`)).trim().toLowerCase(); }
      finally { prompt.close(); }
      if (!tools.includes(options.tool)) throw new Error('请选择有效工具');
    } else throw new Error(existing.length > 1 ? '本包有多个工具安装记录；请用 --tool 明确选择' : '缺少工具；请用 --tool codex|claude|copilot 指定');
  }
  const evidence = options.command === 'init' ? detectProject(options.target) : undefined;
  const result = operate({ root, cfg, options, renderRole, hooks });
  if (options.command === 'preview') output(`${JSON.stringify(result, null, 2)}\n`);
  else {
    output(`目标：${result.target}\n工具：${result.tool}\n`);
    if (evidence?.length) output(`项目证据（仅观察）：\n${evidence.map(entry => `  ${entry.path}：${entry.signal}`).join('\n')}\n`);
    for (const component of result.components) output(`${component.status}：${component.component}\n${component.files.map(file => `  ${file}`).join('\n')}\n`);
    if (result.backupFiles.length) output(`有并发修改的备份需手动比较：\n${result.backupFiles.join('\n')}\n`);
    output(`可在 ${result.tool} 中使用已安装的角色或 Skill；重新加载宿主以刷新发现。详见 README。\n`);
  }
  return result;
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  run().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
