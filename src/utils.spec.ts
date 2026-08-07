import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { formatFileSize, formatTime, toFSStatInfo } from './utils';

describe('createDefaultConfig', () => {
  it('每次调用应返回独立的新对象', () => {
    const a = createDefaultConfig();
    const b = createDefaultConfig();
    expect(a).not.toBe(b);
    a.slient = true;
    expect(b.slient).toBe(false);
  });

  it('threads 应基于 CPU 核心数', () => {
    const cfg = createDefaultConfig();
    expect(cfg.threads).toBeGreaterThanOrEqual(1);
    expect(cfg.threads).toBeLessThanOrEqual(os.cpus().length);
  });
});

describe('formatFileSize', () => {
  it('小于 1KB 应以 B 显示', () => {
    expect(formatFileSize(512)).toBe('512B');
  });

  it('1KB-1MB 应以 KB 显示', () => {
    expect(formatFileSize(2048)).toContain('KB');
  });

  it('大于 1MB 应以 M 显示', () => {
    expect(formatFileSize(2 * 1024 * 1024)).toContain('M');
  });

  it('大于 1GB 应以 G 显示', () => {
    expect(formatFileSize(2 * 1024 * 1024 * 1024)).toContain('G');
  });
});

describe('formatTime', () => {
  it('应返回 HH:MM:SS 格式', () => {
    const result = formatTime(3661000); // 1h 1m 1s
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});

describe('toFSStatInfo', () => {
  it('应正确转换 fs.Stats', () => {
    const tmpFile = path.join(os.tmpdir(), `dfc-test-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, 'hello');
    const stat = fs.statSync(tmpFile);
    const info = toFSStatInfo(stat);
    expect(info.isFile).toBe(true);
    expect(info.isDirectory).toBe(false);
    expect(info.size).toBe(5);
    expect(info.atime).toBeInstanceOf(Date);
    expect(info.mtime).toBeInstanceOf(Date);
    fs.unlinkSync(tmpFile);
  });
});
