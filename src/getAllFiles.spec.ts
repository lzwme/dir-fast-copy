import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import type { DfcConfig } from './type';
import { getAllFiles } from './utils';

const tmpRoots: string[] = [];

function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfc-test-'));
  tmpRoots.push(dir);
  return dir;
}

function makeConfig(src: string, dest: string): DfcConfig {
  return { ...createDefaultConfig(), src, dest };
}

/** 创建目录联接/符号链接，环境不支持时返回 false */
function tryCreateLink(target: string, linkPath: string) {
  try {
    fs.symlinkSync(target, linkPath, 'junction');
    return true;
  } catch {
    return false;
  }
}

afterEach(() => {
  for (const dir of tmpRoots.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // 忽略清理失败
    }
  }
});

describe('getAllFiles', () => {
  it('应正确统计文件与目录', async () => {
    const root = makeTmpDir();
    fs.mkdirSync(path.join(root, 'a'));
    fs.writeFileSync(path.join(root, 'a', 'x.txt'), 'x');
    fs.writeFileSync(path.join(root, 'a', 'y.log'), 'y');
    fs.writeFileSync(path.join(root, 'top.txt'), 't');

    const dest = path.join(root, 'out');
    const stats = await getAllFiles(makeConfig(root, dest), root, dest);

    expect(stats.totalFile).toBe(3);
    expect(stats.totalDir).toBe(1);
    expect(stats.allFilePaths.every((f) => f.dest.startsWith(dest))).toBe(true);
  });

  it('exclude 规则应生效', async () => {
    const root = makeTmpDir();
    fs.mkdirSync(path.join(root, 'a'));
    fs.writeFileSync(path.join(root, 'a', 'x.txt'), 'x');
    fs.writeFileSync(path.join(root, 'a', 'y.log'), 'y');

    const dest = path.join(root, 'out');
    const config = makeConfig(root, dest);
    config.exclude = [/\.log$/];
    const stats = await getAllFiles(config, root, dest);

    expect(stats.totalFile).toBe(1);
    expect(stats.allFilePaths[0].src.endsWith('x.txt')).toBe(true);
  });

  /**
   * 回归：不能用 Dirent.isDirectory()/isFile() 判断条目类型。
   * Windows 下 pnpm 使用目录联接(junction)，Dirent 对链接返回两种判断均为 false，
   * 会导致链接指向的目录/文件被整体跳过而漏复制。
   */
  it('应跟随目录联接(junction)下的文件与子目录', async () => {
    const root = makeTmpDir();
    const real = path.join(root, 'real');
    fs.mkdirSync(path.join(real, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(real, 'nested', 'a.txt'), 'a');

    const link = path.join(root, 'link');
    if (!tryCreateLink(real, link)) return; // 当前环境不支持创建链接

    const dest = path.join(root, 'out');
    const stats = await getAllFiles(makeConfig(root, dest), root, dest);

    // real/nested/a.txt + link/nested/a.txt
    expect(stats.totalFile).toBe(2);
    // real、real/nested、link、link/nested
    expect(stats.totalDir).toBe(4);
    expect(stats.allFilePaths.some((f) => f.src.startsWith(link))).toBe(true);
  });

  /** 回归：链接成环时不应无限递归 */
  it('链接成环时应能正常结束', async () => {
    const root = makeTmpDir();
    const sub = path.join(root, 'sub');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'b.txt'), 'b');

    if (!tryCreateLink(root, path.join(sub, 'loop'))) return; // 当前环境不支持创建链接

    const dest = path.join(root, 'out');
    const stats = await getAllFiles(makeConfig(root, dest), root, dest);

    expect(stats.totalFile).toBeGreaterThanOrEqual(1);
  });
});
