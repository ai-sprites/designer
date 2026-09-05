import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { run } from '../bin/cli.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(file, 'utf8');
const put = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
function temp(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sprite-install-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function fixture(base, id = 'sample', version = '1.0.0') {
  const root = path.join(base, `${id}-${version}`);
  const practices = [`sprite-${id}-one`, `sprite-${id}-two`];
  put(path.join(root, 'package.json'), JSON.stringify({ name: `@ai-sprites/${id}`, type: 'module', version, sprite: { id, role: true, practices, baseSkills: [] } }));
  put(path.join(root, 'templates/agent.md'), `# 独立角色\n\n处理当前任务 ${version}。\n`);
  for (const skill of practices) {
    put(path.join(root, 'skills', skill, 'SKILL.md'), `---\nname: ${skill}\ndescription: 本地实践\n---\n\n参考 [说明](references/guide.md)。\n`);
    put(path.join(root, 'skills', skill, 'references/guide.md'), `实践 ${version}\n`);
  }
  return { root, id, practices };
}
function invoke(f, target, args = [], hooks) {
  return run({ root: f.root, argv: [args[0] ?? 'init', target, ...args.slice(1)], output: () => {}, input: { isTTY: false }, terminalOutput: { isTTY: false }, hooks });
}
const statePath = (target, id = 'sample', tool = 'codex') => path.join(target, `.sprite/installations/${id}.${tool}.json`);
const state = (target, id = 'sample', tool = 'codex') => JSON.parse(read(statePath(target, id, tool)));
const agent = (target, id = 'sample') => path.join(target, `.codex/agents/sprite-${id}.toml`);
const skill = (target, id = 'sample', which = 'one', file = 'SKILL.md') => path.join(target, `.agents/skills/sprite-${id}-${which}/${file}`);
function files(root) {
  const result = {};
  if (!fs.existsSync(root)) return result;
  function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else result[path.relative(root, full)] = read(full); } }
  walk(root);
  return result;
}

test('各工具独立初始化；只生成选择的工具，重复安装不改原文件', async t => {
  const base = temp(t), f = fixture(base);
  for (const tool of ['codex', 'claude', 'copilot']) {
    const target = path.join(base, tool);
    put(path.join(target, 'README.md'), '项目原说明');
    put(path.join(target, '.codex/config.toml'), '原配置');
    await invoke(f, target, ['init', '--tool', tool]);
    const before = files(target);
    await invoke(f, target, ['init']);
    assert.deepEqual(files(target), before);
    assert.equal(read(path.join(target, 'README.md')), '项目原说明');
    assert.deepEqual(Object.keys(state(target, f.id, tool).components), ['role']);
    const generated = Object.keys(before).find(name => name.includes('agents/sprite-'));
    assert.ok(generated);
    const text = before[generated];
    assert.match(text, /sprite-sample/);
    assert.ok(tool === 'codex' ? text.includes('developer_instructions = ') : text.startsWith('---\n'));
    assert.ok(!Object.keys(before).some(name => name.includes('.ai-sdlc') || name.includes('workflow')));
  }
});

test('必要选项、唯一工具复用、多工具不猜测和错误参数', async t => {
  const base = temp(t), f = fixture(base), target = path.join(base, 'project');
  await assert.rejects(invoke(f, target), /缺少工具/);
  for (const args of [['init', '--tool', 'wrong'], ['init', '--tool', 'codex', '--wat'], ['init', '--tool', 'codex', '--tool', 'claude'], ['init', '--tool', 'codex', '--practices', 'unknown'], ['init', '--tool', 'codex', '--role', '--skills-only']]) await assert.rejects(invoke(f, target, args));
  await invoke(f, target, ['init', '--tool', 'codex']);
  await invoke(f, target, ['update']);
  await invoke(f, target, ['init', '--tool', 'claude']);
  await assert.rejects(invoke(f, target, ['update']), /多个工具/);
});

test('实践空、部分、全部、仅实践、追加角色与选择减少不隐式移除', async t => {
  const base = temp(t), f = fixture(base), target = path.join(base, 'project');
  await invoke(f, target, ['init', '--tool', 'codex', '--skills-only', '--practices', f.practices[0]]);
  assert.ok(!fs.existsSync(agent(target)));
  const practiceBefore = files(path.dirname(skill(target)));
  await invoke(f, target, ['init', '--practices', 'none']);
  assert.ok(fs.existsSync(agent(target)));
  assert.deepEqual(files(path.dirname(skill(target))), practiceBefore);
  await invoke(f, target, ['init', '--practices', 'all']);
  assert.equal(Object.keys(state(target).components).length, 3);
  await invoke(f, target, ['init', '--practices', f.practices[0]]);
  assert.equal(Object.keys(state(target).components).length, 3);
});

test('角色以不同顺序共存，单包更新保留其他包', async t => {
  const base = temp(t);
  const first = fixture(base, 'first'), second = fixture(base, 'second');
  const newer = fixture(base, 'first', '2.0.0');
  for (const [index, order] of [[first, second], [second, first]].entries()) {
    const target = path.join(base, `project-${index}`);
    for (const f of order) await invoke(f, target, ['init', '--tool', 'codex', '--practices', 'all']);
    const otherAgent = read(agent(target, 'second'));
    const otherRecord = read(statePath(target, 'second'));
    await invoke(newer, target, ['update']);
    assert.equal(read(agent(target, 'second')), otherAgent);
    assert.equal(read(statePath(target, 'second')), otherRecord);
  }
});

test('真实版本更新：独立角色与实践范围、新文件及被移除内容', async t => {
  const base = temp(t), old = fixture(base), newer = fixture(base, 'sample', '2.0.0'), target = path.join(base, 'project');
  await invoke(old, target, ['init', '--tool', 'codex', '--practices', 'all']);
  const oldState = state(target);
  const oldPractice = read(skill(target, 'sample', 'one', 'references/guide.md'));
  await invoke(newer, target, ['update', '--role']);
  assert.match(read(agent(target)), /2\.0\.0/);
  assert.equal(read(skill(target, 'sample', 'one', 'references/guide.md')), oldPractice);
  assert.deepEqual(state(target).components['skill:sprite-sample-one'], oldState.components['skill:sprite-sample-one']);
  fs.unlinkSync(path.join(newer.root, 'skills', newer.practices[0], 'references/guide.md'));
  put(path.join(newer.root, 'skills', newer.practices[0], 'references/new.md'), '新参考');
  const roleBefore = read(agent(target));
  const secondBefore = state(target).components['skill:sprite-sample-two'];
  await invoke(newer, target, ['update', '--practices', newer.practices[0]]);
  assert.ok(!fs.existsSync(skill(target, 'sample', 'one', 'references/guide.md')));
  assert.equal(read(skill(target, 'sample', 'one', 'references/new.md')), '新参考');
  assert.equal(read(agent(target)), roleBefore);
  assert.deepEqual(state(target).components['skill:sprite-sample-two'], secondBefore);
  const before = files(target);
  await invoke(old, target, ['init']);
  assert.deepEqual(files(target), before, '重复 init 不降级内容或记录');
});

test('一次报告用户修改和无归属文件冲突，无部分安装；preview 无写入', async t => {
  const base = temp(t), f = fixture(base), newer = fixture(base, 'sample', '2.0.0'), target = path.join(base, 'project');
  await invoke(f, target, ['init', '--tool', 'codex']);
  put(agent(target), '用户定制');
  put(skill(target), '无归属同名文件');
  const before = files(target);
  await assert.rejects(invoke(newer, target, ['init', '--practices', 'all']), error => error.message.includes('sprite-sample.toml') && error.message.includes('sprite-sample-one/SKILL.md'));
  assert.deepEqual(files(target), before);
  const result = await invoke(newer, target, ['preview', '--role']);
  assert.match(result.preview[0].files[0].content, /2\.0\.0/);
  assert.deepEqual(files(target), before);
  const empty = path.join(base, 'empty-preview');
  await invoke(f, empty, ['preview', '--tool', 'codex']);
  assert.ok(!fs.existsSync(empty));
});

test('明确移除实践，保护用户增加和修改的内容', async t => {
  const base = temp(t), f = fixture(base), target = path.join(base, 'project');
  await invoke(f, target, ['init', '--tool', 'codex', '--practices', 'all']);
  put(skill(target, 'sample', 'one', 'notes.md'), '用户资料');
  await invoke(f, target, ['remove', '--practices', f.practices[0]]);
  assert.equal(read(skill(target, 'sample', 'one', 'notes.md')), '用户资料');
  assert.ok(!fs.existsSync(skill(target)));
  put(skill(target, 'sample', 'two'), '用户修改');
  const before = files(target);
  await assert.rejects(invoke(f, target, ['remove', '--practices', f.practices[1]]), /冲突/);
  assert.deepEqual(files(target), before);
});

test('拒绝伪造归属和记录格式，包括编码后的目录穿越', async t => {
  const base = temp(t), f = fixture(base), target = path.join(base, 'project');
  await invoke(f, target, ['init', '--tool', 'codex']);
  const original = read(statePath(target));
  const outside = path.join(base, 'outside'); put(outside, '保留');
  const badStates = [
    { ...JSON.parse(original), formatVersion: 99 },
    { ...JSON.parse(original), package: 'another' },
    { ...JSON.parse(original), components: { role: { version: '1', files: { '../outside': '0'.repeat(64) } } } },
    { ...JSON.parse(original), components: { 'skill:sprite-sample-one': { version: '1', files: { '.agents/skills/sprite-sample-one/../../outside': '0'.repeat(64) } } } },
    { ...JSON.parse(original), components: { 'skill:sprite-other': { version: '1', files: { '.agents/skills/sprite-other/SKILL.md': '0'.repeat(64) } } } },
  ];
  for (const bad of badStates) {
    put(statePath(target), JSON.stringify(bad));
    const before = read(agent(target));
    await assert.rejects(invoke(f, target, ['update']));
    assert.equal(read(agent(target)), before);
    assert.equal(read(outside), '保留');
  }
  // JSON duplicate keys use their final interpreted value; validation must still
  // reject a dangerous replacement, including a Unicode-escaped parent segment.
  put(statePath(target), original.replace('"components": {', '"components": {}, "components": {').replace('.codex/agents/sprite-sample.toml', '\\u002e\\u002e/outside'));
  await assert.rejects(invoke(f, target, ['update']));
  assert.equal(read(outside), '保留');
});

test('拒绝目标和源码符号链接、硬链接、目录替换', async t => {
  const base = temp(t), f = fixture(base), outside = path.join(base, 'outside');
  fs.mkdirSync(outside);
  const target = path.join(base, 'project'); fs.mkdirSync(target);
  fs.symlinkSync(outside, path.join(target, '.codex'));
  await assert.rejects(invoke(f, target, ['init', '--tool', 'codex']), /目录不是普通/);
  assert.deepEqual(files(outside), {});
  fs.unlinkSync(path.join(target, '.codex'));
  await invoke(f, target, ['init', '--tool', 'codex']);
  fs.linkSync(agent(target), path.join(outside, 'linked'));
  await assert.rejects(invoke(f, target, ['update']), /独占/);
  fs.unlinkSync(path.join(outside, 'linked'));
  fs.unlinkSync(path.join(f.root, 'skills', f.practices[0], 'references/guide.md'));
  fs.symlinkSync(agent(target), path.join(f.root, 'skills', f.practices[0], 'references/guide.md'));
  const before = files(target);
  await assert.rejects(invoke(f, target, ['init', '--practices', f.practices[0]]), /符号链接/);
  assert.deepEqual(files(target), before);
});

test('中途失败恢复旧版本和记录、删除本次未改动新文件', async t => {
  const base = temp(t), old = fixture(base), newer = fixture(base, 'sample', '2.0.0'), target = path.join(base, 'project');
  await invoke(old, target, ['init', '--tool', 'codex', '--practices', 'all']);
  fs.unlinkSync(path.join(newer.root, 'skills', newer.practices[0], 'references/guide.md'));
  put(path.join(newer.root, 'skills', newer.practices[0], 'references/new.md'), '新文件');
  const before = files(target);
  await assert.rejects(invoke(newer, target, ['update'], { afterWrite(op, index) { if (index === 2) throw new Error('注入中断'); } }), /注入中断/);
  assert.deepEqual(files(target), before);
  const empty = path.join(base, 'empty');
  await assert.rejects(invoke(old, empty, ['init', '--tool', 'codex', '--practices', 'all'], { afterWrite() { throw new Error('注入中断'); } }), /注入中断/);
  assert.deepEqual(files(empty), {});
});

test('预检后出现用户修改或目录替换立即停止；回滚保留并发修改', async t => {
  const base = temp(t), old = fixture(base), newer = fixture(base, 'sample', '2.0.0'), target = path.join(base, 'project');
  await invoke(old, target, ['init', '--tool', 'codex', '--practices', 'all']);
  const original = read(agent(target));
  await assert.rejects(invoke(newer, target, ['update'], { afterPreflight() { put(agent(target), '并发修改'); } }), /发生变化/);
  assert.equal(read(agent(target)), '并发修改');
  put(agent(target), original);
  await assert.rejects(invoke(newer, target, ['update'], { afterWrite(op, index) { if (index === 0) { put(op.file, '用户在写入后修改'); throw new Error('注入中断'); } } }), /保留备份/);
  assert.equal(read(agent(target)), '用户在写入后修改');
  const backups = fs.readdirSync(path.dirname(agent(target))).filter(name => name.includes('.sprite-backup-'));
  assert.equal(backups.length, 1);
  assert.equal(read(path.join(path.dirname(agent(target)), backups[0])), original);
  const another = path.join(base, 'another');
  await invoke(old, another, ['init', '--tool', 'codex']);
  const dir = path.join(another, '.codex/agents');
  await assert.rejects(invoke(newer, another, ['update'], { afterPreflight() { fs.renameSync(dir, `${dir}-old`); fs.mkdirSync(dir); } }), /目录在操作中被替换/);
  assert.deepEqual(files(dir), {});
});

test('并发命令锁不吞并安装状态，也不移除其他命令的锁', async t => {
  const base = temp(t), f = fixture(base), target = path.join(base, 'project');
  const lock = `${statePath(target)}.lock`;
  put(lock, '另一个命令');
  await assert.rejects(invoke(f, target, ['init', '--tool', 'codex']), /正在操作/);
  assert.equal(read(lock), '另一个命令');
  assert.ok(!fs.existsSync(agent(target)));
});

test('只读项目探测只显示简要来源，不执行脚本或输出秘密', async t => {
  const base = temp(t), f = fixture(base), target = path.join(base, 'project');
  put(path.join(target, 'package.json'), JSON.stringify({ secret: 'DO_NOT_PRINT', dependencies: { react: 'SECRET_VERSION' }, scripts: { test: 'touch hacked; echo SECRET_SCRIPT' } }));
  let output = '';
  await run({ root: f.root, argv: ['init', target, '--tool', 'codex'], output: text => { output += text; } });
  assert.match(output, /package\.json/);
  assert.match(output, /react/);
  assert.match(output, /test/);
  assert.doesNotMatch(output, /DO_NOT_PRINT|SECRET_VERSION|SECRET_SCRIPT/);
  assert.ok(!fs.existsSync(path.join(target, 'hacked')));
  assert.ok(!Object.keys(files(target)).some(name => name.includes('profile')));
});

test('桥接无需角色，随自身 Skill 安装相对工具，并从实际 CLI 入口运行', async t => {
  const base = temp(t), root = path.join(base, 'bridge'), target = path.join(base, 'project');
  put(path.join(root, 'package.json'), JSON.stringify({ name: '@ai-sprites/artifact-bridge', type: 'module', version: '1.0.0', sprite: { id: 'artifact-bridge', role: false, practices: [], baseSkills: ['sprite-artifact-bridge'] } }));
  put(path.join(root, 'skills/sprite-artifact-bridge/SKILL.md'), '用 node scripts/read.js 读取资料');
  put(path.join(root, 'skills/sprite-artifact-bridge/scripts/read.js'), 'console.log("fixture-reader")');
  fs.cpSync(path.join(packageRoot, 'bin'), path.join(root, 'bin'), { recursive: true });
  fs.cpSync(path.join(packageRoot, 'lib'), path.join(root, 'lib'), { recursive: true });
  const result = spawnSync(process.execPath, [path.join(root, 'bin/cli.js'), 'init', target, '--tool', 'codex'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(Object.keys(state(target, 'artifact-bridge').components), ['skill:sprite-artifact-bridge']);
  assert.ok(!fs.existsSync(path.join(target, '.codex/agents')));
  const tool = spawnSync(process.execPath, [path.join(target, '.agents/skills/sprite-artifact-bridge/scripts/read.js')], { encoding: 'utf8' });
  assert.equal(tool.stdout.trim(), 'fixture-reader');
});

test('部分文件写入失败按实际已写字节恢复；新建空文件也能回滚', async t => {
  const base = temp(t), old = fixture(base), newer = fixture(base, 'sample', '2.0.0'), target = path.join(base, 'project');
  await invoke(old, target, ['init', '--tool', 'codex']);
  put(path.join(newer.root, 'templates/agent.md'), `# 独立角色\n\n新版本\n${'较长正文'.repeat(40000)}`);
  const before = files(target);
  await assert.rejects(invoke(newer, target, ['update'], { beforeFileChunk(op, written) { if (written > 0) throw new Error('ENOSPC 注入磁盘不足'); } }), /ENOSPC/);
  assert.deepEqual(files(target), before);
  const empty = path.join(base, 'empty');
  await assert.rejects(invoke(old, empty, ['init', '--tool', 'codex'], { beforeFileChunk() { throw new Error('ENOSPC 首次写入失败'); } }), /ENOSPC/);
  assert.deepEqual(files(empty), {});
});

test('选中但未变化的文件与安装记录在预检后被修改也会停止', async t => {
  const base = temp(t), old = fixture(base), newer = fixture(base, 'sample', '2.0.0'), target = path.join(base, 'project');
  await invoke(old, target, ['init', '--tool', 'codex', '--practices', 'all']);
  const firstSkill = skill(target);
  const originalSkill = read(firstSkill);
  const originalState = read(statePath(target));
  const originalAgent = read(agent(target));
  // The two fixture versions have identical SKILL.md bytes, while the role and
  // reference body change. This SKILL.md would otherwise have no write operation.
  await assert.rejects(invoke(newer, target, ['update'], { afterPreflight() { put(firstSkill, '用户修改了未变化的选中内容'); } }), /发生变化/);
  assert.equal(read(firstSkill), '用户修改了未变化的选中内容');
  assert.equal(read(agent(target)), originalAgent);
  assert.equal(read(statePath(target)), originalState);
  put(firstSkill, originalSkill);
  await assert.rejects(invoke(newer, target, ['update'], { afterPreflight() { put(statePath(target), '用户正在修订记录'); } }), /发生变化/);
  assert.equal(read(statePath(target)), '用户正在修订记录');
  assert.equal(read(agent(target)), originalAgent);
});

test('npm 使用的可执行符号链接能运行帮助和实际安装', async t => {
  const base = temp(t), f = fixture(base), target = path.join(base, 'project');
  fs.cpSync(path.join(packageRoot, 'bin'), path.join(f.root, 'bin'), { recursive: true });
  fs.cpSync(path.join(packageRoot, 'lib'), path.join(f.root, 'lib'), { recursive: true });
  const link = path.join(base, 'sprite-sample');
  fs.symlinkSync(path.join(f.root, 'bin/cli.js'), link);
  const help = spawnSync(process.execPath, [link, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /独立安装与安全更新/);
  const result = spawnSync(process.execPath, [link, 'init', target, '--tool', 'codex'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(agent(target)));
});


test('退休实践不阻塞独立角色更新，可明确移除且不接管相近包名', async t => {
  const base = temp(t), old = fixture(base), newer = fixture(base, 'sample', '2.0.0'), target = path.join(base, 'project');
  await invoke(old, target, ['init', '--tool', 'codex', '--practices', 'all']);
  const pkgPath = path.join(newer.root, 'package.json');
  const pkg = JSON.parse(read(pkgPath));
  pkg.sprite.practices = [old.practices[0]];
  put(pkgPath, JSON.stringify(pkg));
  fs.rmSync(path.join(newer.root, 'skills', old.practices[1]), { recursive: true });
  const retiredRecord = state(target).components[`skill:${old.practices[1]}`];
  const retiredFile = skill(target, 'sample', 'two');
  const retiredOriginal = read(retiredFile);
  put(retiredFile, '用户保留的退休实践');
  await invoke(newer, target, ['update', '--role']);
  assert.match(read(agent(target)), /2\.0\.0/);
  assert.equal(read(retiredFile), '用户保留的退休实践');
  assert.deepEqual(state(target).components[`skill:${old.practices[1]}`], retiredRecord);
  await invoke(newer, target, ['preview', '--role']);
  const before = files(target);
  await assert.rejects(invoke(newer, target, ['update']), /当前包已不提供实践/);
  await assert.rejects(invoke(newer, target, ['update', '--practices', old.practices[1]]), /当前包已不提供实践/);
  await assert.rejects(invoke(newer, target, ['remove', '--practices', old.practices[1]]), /冲突/);
  assert.deepEqual(files(target), before);
  put(retiredFile, retiredOriginal);
  put(skill(target, 'sample', 'two', 'user-notes.md'), '用户资料');
  await invoke(newer, target, ['remove', '--practices', old.practices[1]]);
  assert.ok(!fs.existsSync(retiredFile));
  assert.equal(read(skill(target, 'sample', 'two', 'user-notes.md')), '用户资料');
  assert.ok(!state(target).components[`skill:${old.practices[1]}`]);
  await invoke(newer, target, ['update']);

  const originalState = read(statePath(target));
  let record = JSON.parse(originalState);
  record.components['skill:sprite-samplex-one'] = { version: '1.0.0', files: { '.agents/skills/sprite-samplex-one/SKILL.md': '0'.repeat(64) } };
  put(statePath(target), JSON.stringify(record));
  await assert.rejects(invoke(newer, target, ['update', '--role']), /记录不受支持或已损坏/);
  put(statePath(target), originalState);
  record = JSON.parse(originalState);
  record.components['skill:sprite-sample-old'] = { version: '1.0.0', files: { '.agents/skills/sprite-samplex-one/SKILL.md': '0'.repeat(64) } };
  put(statePath(target), JSON.stringify(record));
  await assert.rejects(invoke(newer, target, ['update', '--role']), /记录不受支持或已损坏/);
  put(statePath(target), originalState);
  record = JSON.parse(originalState);
  record.components['skill:sprite-sample-old'] = { version: '1.0.0', files: { '.agents/skills/sprite-sample-old/../../outside': '0'.repeat(64) } };
  put(statePath(target), JSON.stringify(record));
  await assert.rejects(invoke(newer, target, ['update', '--role']), /不安全的相对路径/);
  put(statePath(target), originalState);
  pkg.sprite.practices = ['sprite-samplex-one'];
  put(pkgPath, JSON.stringify(pkg));
  await assert.rejects(invoke(newer, target, ['init', '--practices', 'all']), /名称必须唯一并属于本包/);
});
