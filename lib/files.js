import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const sameNode = (a, b) => a && b && a.dev === b.dev && a.ino === b.ino;
export function stat(file) {
  try { return fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export function relative(file) {
  if (typeof file !== 'string' || !file || file.includes('\\') || file.includes('\0') || path.posix.isAbsolute(file) || file.split('/').some(p => !p || p === '.' || p === '..')) throw new Error(`不安全的相对路径：${String(file)}`);
  return file;
}
// Never follow a symlink, including above the selected project directory.
export function checkParents(file, identities = new Map()) {
  const parent = path.dirname(path.resolve(file));
  const parts = parent.split(path.sep).filter(Boolean);
  let current = path.parse(parent).root;
  for (const part of parts) {
    current = path.join(current, part);
    const info = stat(current);
    if (!info) {
      if (identities.has(current)) throw new Error(`目录在操作中消失：${current}`);
      continue;
    }
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`目录不是普通目录：${current}`);
    if (identities.has(current) && !sameNode(identities.get(current), info)) throw new Error(`目录在操作中被替换：${current}`);
    identities.set(current, info);
  }
  return identities;
}
export function readRegular(file, identities) {
  checkParents(file, identities);
  const before = stat(file);
  if (!before) return null;
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw new Error(`文件不是独占的普通文件：${file}`);
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const info = fs.fstatSync(descriptor);
    if (!sameNode(before, info) || info.nlink !== 1) throw new Error(`文件在读取中被替换：${file}`);
    const data = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (!sameNode(info, stat(file)) || after.nlink !== 1 || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs) throw new Error(`文件在读取中发生变化：${file}`);
    return { data, hash: hash(data), info };
  } finally { fs.closeSync(descriptor); }
}
export function sourceTree(root) {
  const result = new Map();
  const walk = (dir, prefix) => {
    checkParents(path.join(dir, '_'));
    if (!stat(dir)?.isDirectory() || stat(dir)?.isSymbolicLink()) throw new Error(`缺少普通源码目录：${dir}`);
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name);
      const rel = relative(prefix ? `${prefix}/${name}` : name);
      const info = stat(file);
      if (info?.isSymbolicLink()) throw new Error(`源码不能包含符号链接：${file}`);
      if (info?.isDirectory()) walk(file, rel);
      else result.set(rel, readRegular(file).data);
    }
  };
  walk(root, '');
  return result;
}
function unchanged(file, snapshot, identities) {
  const now = readRegular(file, identities);
  if (snapshot === null ? now !== null : !now || !sameNode(now.info, snapshot.info) || now.hash !== snapshot.hash) throw new Error(`文件在操作中发生变化：${file}`);
  return now;
}
function ensureParent(file, identities, directories) {
  const parent = path.dirname(file);
  checkParents(file, identities);
  if (stat(parent)) return;
  ensureParent(parent, identities, directories);
  try {
    fs.mkdirSync(parent);
    const info = stat(parent);
    identities.set(parent, info);
    directories.push([parent, info]);
  } catch (error) { if (error.code !== 'EEXIST') throw error; checkParents(file, identities); }
}
function cleanupDirectories(directories) {
  for (const [dir, info] of [...directories].reverse()) {
    try { if (sameNode(stat(dir), info) && !stat(dir).isSymbolicLink()) fs.rmdirSync(dir); } catch { /* Nonempty or changed directories belong to the caller. */ }
  }
}
// Locks coordinate this package's commands, not user editors. Every selected file is
// checked again immediately before mutation. A backup is retained if safe restoration
// is impossible; no force overwrite is used, even during rollback.
export function transaction({ lockFile, metadataFile, build, hooks = {} }) {
  const identities = new Map();
  const directories = [];
  const journal = [];
  const leftovers = [];
  let lock;
  const token = crypto.randomUUID();
  try {
    checkParents(lockFile, identities);
    ensureParent(lockFile, identities, directories);
    try { fs.writeFileSync(lockFile, `${process.pid}\n${token}\n`, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code === 'EEXIST') throw new Error(`本包正在操作或上次中断留下锁：${lockFile}。确认没有正在运行的命令后可移除此锁。`); throw error; }
    lock = readRegular(lockFile, identities);
    const { operations, guards = new Map() } = build(identities);
    const checkGuards = () => {
      for (const [file, snapshot] of guards) unchanged(file, snapshot, identities);
    };
    checkGuards();
    const unique = new Set();
    for (const op of operations) {
      if (unique.has(op.file)) throw new Error(`重复目标：${op.file}`);
      unique.add(op.file);
      op.before = readRegular(op.file, identities);
      if (op.expected === null ? op.before !== null : op.before?.hash !== op.expected) throw new Error(`写前冲突：${op.file}`);
    }
    hooks.afterPreflight?.(operations);
    let index = 0;
    for (const op of operations) {
      hooks.beforeWrite?.(op, index);
      checkGuards();
      ensureParent(op.file, identities, directories);
      unchanged(op.file, op.before, identities);
      const record = { ...op, backup: null, created: null };
      journal.push(record);
      guards.delete(op.file);
      if (op.before) {
        // Move the old inode away, then create exclusively. A concurrently created
        // destination is never overwritten by rename.
        record.backup = `${op.file}.sprite-backup-${token}`;
        if (stat(record.backup)) throw new Error(`备份路径冲突：${record.backup}`);
        fs.renameSync(op.file, record.backup);
        unchanged(record.backup, op.before, identities);
      }
      if (op.data !== null) {
        const descriptor = fs.openSync(op.file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, op.before ? op.before.info.mode & 0o777 : 0o644);
        record.created = { info: fs.fstatSync(descriptor), hash: hash(Buffer.alloc(0)) };
        try {
          let written = 0;
          while (written < op.data.length) {
            hooks.beforeFileChunk?.(op, written);
            const count = fs.writeSync(descriptor, op.data, written, Math.min(64 * 1024, op.data.length - written));
            if (count === 0) throw new Error(`文件写入没有进展：${op.file}`);
            written += count;
            record.created.hash = hash(op.data.subarray(0, written));
          }
          fs.fsyncSync(descriptor);
        }
        finally { fs.closeSync(descriptor); }
      }
      hooks.afterWrite?.(op, index++);
    }
    // Check the whole selected transaction before committing, including unchanged files.
    checkGuards();
    for (const record of journal) {
      unchanged(record.file, record.created, identities);
      if (record.backup) unchanged(record.backup, record.before, identities);
    }
    for (const record of journal) if (record.backup) {
      // A late user edit to the backup must survive cleanup.
      try { unchanged(record.backup, record.before, identities); fs.unlinkSync(record.backup); }
      catch { leftovers.push(record.backup); }
    }
    return { backupFiles: leftovers, metadataFile };
  } catch (error) {
    for (const record of [...journal].reverse()) {
      try {
        checkParents(record.file, identities);
        if (record.created) { unchanged(record.file, record.created, identities); fs.unlinkSync(record.file); }
        if (record.backup && stat(record.backup)) {
          // Preserve a modified original inode too. Linking cannot replace an
          // independently created destination. Do not restore through symlinks.
          readRegular(record.backup, identities);
          if (stat(record.file)) throw new Error('恢复目标已被占用');
          fs.linkSync(record.backup, record.file);
          fs.unlinkSync(record.backup);
        }
      } catch { if (record.backup) leftovers.push(record.backup); }
    }
    if (leftovers.length) error.message += `\n保留备份，需人工比较：\n${leftovers.join('\n')}`;
    throw error;
  } finally {
    if (lock) { try { unchanged(lockFile, lock, identities); fs.unlinkSync(lockFile); } catch { /* Keep a changed lock. */ } }
    cleanupDirectories(directories);
  }
}
