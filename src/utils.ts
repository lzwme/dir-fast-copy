import { color } from 'console-log-colors';
import { type Dir, existsSync, mkdirSync, promises, readdirSync, rmdirSync, statSync, utimes, utimesSync } from 'fs';
import { dirname, resolve } from 'path';
import * as readline from 'readline';
import type { DfcConfig, DfcFileItem, DfcStats, FsStatInfo } from './type';

// ============================================================
// 日志工具函数
// ============================================================

export function logPrint(config: DfcConfig | null, ...args: unknown[]) {
  if (config?.slient) return;
  console.log(...args);
}

export function logInline(config: DfcConfig | null, msg: string) {
  if (config?.slient) return;
  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);
  process.stdout.write(msg, 'utf-8');
}

// ============================================================
// 时间/格式化工具
// ============================================================

export function formatTime(timeMs: number) {
  return new Date(new Date('1970-01-01T00:00:00').getTime() + timeMs).toTimeString().split(' ')[0];
}

export function showCostTime(startTime: number) {
  return color.cyan(formatTime(Date.now() - startTime));
}

export function formatFileSize(size: number) {
  if (size > 1 << 30) return `${(size / (1 << 30)).toFixed(2)}G`;
  if (size > 1 << 20) return `${(size / (1 << 20)).toFixed(2)}M`;
  if (size > 1 << 10) return `${(size / (1 << 10)).toFixed(2)}KB`;
  return `${size}B`;
}

// ============================================================
// FS 工具函数
// ============================================================

export function toFSStatInfo(fstat: {
  isFile(): boolean;
  isDirectory(): boolean;
  nlink: number;
  atime: Date;
  mtime: Date;
  size: number;
}): FsStatInfo {
  return {
    isFile: fstat.isFile(),
    isDirectory: fstat.isDirectory(),
    nlink: fstat.nlink,
    atime: fstat.atime,
    mtime: fstat.mtime,
    size: fstat.size,
  };
}

// ============================================================
// 文件/目录过滤
// ============================================================

export function isExclude(config: DfcConfig, srcFilePath: string, srcStat?: FsStatInfo): boolean {
  const excludes = config.exclude || [];
  for (const d of excludes) {
    if (d instanceof RegExp) {
      if (d.test(srcFilePath)) return true;
    } else {
      if (srcFilePath.includes(String(d))) return true;
    }
  }

  const includes = config.include || [];
  if (includes.length > 0) {
    if (!srcStat) srcStat = toFSStatInfo(statSync(srcFilePath));
    if (srcStat.isFile) {
      return !includes.some((d: string | RegExp) => (d instanceof RegExp ? d.test(srcFilePath) : srcFilePath.includes(String(d))));
    }
  }

  return false;
}

export async function checkFile(
  srcFilePath: string,
  destFilePath: string,
  srcStat: FsStatInfo,
  config: DfcConfig,
): Promise<FsStatInfo | 'dir' | undefined> {
  if (isExclude(config, srcFilePath, srcStat)) return undefined;

  if (srcStat.isDirectory) return 'dir';

  if (srcStat.mtime.getTime() < (config.minDateTime || 0)) return undefined;

  if (config.skipSameFile) {
    if (existsSync(destFilePath) && statSync(destFilePath).size === srcStat.size) {
      if (config.deleteSrc) await promises.unlink(srcFilePath);
      return undefined;
    }
  }

  return srcStat;
}

// ============================================================
// 文件和目录复制（带重试机制）
// ============================================================

const MAX_RETRY_COUNT = 3;
const RETRY_DELAY_MS = 100;

/** 带重试的文件复制 */
export async function cpFile(
  config: DfcConfig,
  srcPath: string,
  destPath: string,
  srcStat: FsStatInfo,
  retryCount = MAX_RETRY_COUNT,
): Promise<void> {
  for (let attempt = 1; attempt <= retryCount; attempt++) {
    try {
      await promises.copyFile(srcPath, destPath);
      await promises.utimes(destPath, srcStat.atime, srcStat.mtime);
      if (config.deleteSrc === true) await promises.unlink(srcPath);
      return; // 成功，直接返回
    } catch (err) {
      if (attempt < retryCount) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
        continue;
      }
      console.log(`文件复制失败(重试${retryCount}次后):\nsrc: ${srcPath}\ndest: ${destPath}\n`, err);
    }
  }
}

/** 复制一个文件(stream 方式异步，带重试) */
export async function cpFilebyStream(
  config: DfcConfig,
  srcPath: string,
  destPath: string,
  srcStat: FsStatInfo,
  retryCount = MAX_RETRY_COUNT,
) {
  for (let attempt = 1; attempt <= retryCount; attempt++) {
    try {
      const { createReadStream, createWriteStream } = await import('fs');
      await new Promise<void>((rs, reject) => {
        createReadStream(srcPath)
          .pipe(createWriteStream(destPath))
          .on('close', () => {
            utimes(destPath, srcStat.atime, srcStat.mtime, (err) => {
              if (err) reject(err);
              else {
                if (config.deleteSrc === true) promises.unlink(srcPath);
                rs();
              }
            });
          })
          .on('error', reject);
      });
      return; // 成功
    } catch (err) {
      if (attempt < retryCount) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
        continue;
      }
      console.log(`文件复制失败(重试${retryCount}次后):\nsrc: ${srcPath}\ndest: ${destPath}\n`, err);
    }
  }
}

/** 复制一个目录(不作任何检查以保证速度) */
export function cpDir(srcDir: string, destDir: string, srcStat?: FsStatInfo) {
  try {
    if (!srcStat) srcStat = toFSStatInfo(statSync(srcDir));
    mkdirSync(destDir, { recursive: true });
    utimesSync(destDir, srcStat.atime, srcStat.mtime);
  } catch (err) {
    console.log(`目录复制失败:\nsrc: ${srcDir}\ndest: ${destDir}\n`, err);
  }
}

// ============================================================
// 批量文件复制（单线程，带重试）
// ============================================================

export async function fileCopy(
  config: DfcConfig,
  filePathList: DfcStats['allFilePaths'],
  opts: { onProgress?: DfcConfig['onProgress']; onEnd?: DfcConfig['onEnd'] } = {},
) {
  const stats: DfcStats = {
    allFilePaths: filePathList ?? [],
    allDirPaths: [],
    totalFile: filePathList.length,
    totalFileSize: 0,
    totalFileHandler: 0,
    totalFileNew: 0,
    totalFileNewSize: 0,
    totalDir: 0,
    totalDirNew: 0,
  };

  if (!filePathList) return stats;
  const progressTipNum = filePathList.length > 10000 ? 1000 : 100;
  const queueSize = 8;
  let cpFileQueue: Promise<void>[] = [];
  const createdDirs = new Set<string>();

  for (const item of filePathList) {
    const { src: srcPath, dest: destPath, srcStat } = item;
    const check = await checkFile(srcPath, destPath, srcStat, config);

    stats.totalFileHandler++;

    if (stats.totalFileHandler > 1 && stats.totalFileHandler % progressTipNum === 0) {
      opts.onProgress?.(stats);
    }

    if (check === 'dir' || !check) continue;
    stats.totalFileSize += srcStat.size;

    try {
      const destFileDir = dirname(destPath);
      if (!createdDirs.has(destFileDir)) {
        if (!existsSync(destFileDir)) {
          cpDir(dirname(srcPath), destFileDir, srcStat);
          stats.totalDirNew++;
        }
        createdDirs.add(destFileDir);
      }

      if (cpFileQueue.length >= queueSize) {
        await Promise.allSettled(cpFileQueue);
        cpFileQueue = [];
      }

      cpFileQueue.push(cpFile(config, srcPath, destPath, srcStat));
      stats.totalFileNew++;
      stats.totalFileNewSize += srcStat.size;
    } catch (err) {
      console.log(`文件复制失败:\nsrc: ${srcPath}\ndest: ${destPath}\n`, err);
    }
  }

  await Promise.allSettled(cpFileQueue);

  opts.onEnd?.(stats);
  return stats;
}

// ============================================================
// 流式目录遍历（文件发现）- 使用 fs.opendir 异步迭代器
// ============================================================

/**
 * 流式获取所有需处理的文件列表
 * 使用 fs.promises.opendir 的异步迭代器，内存更友好
 */
export async function getAllFiles(config: DfcConfig, _srcDir: string, _destDir = '', onProgress?: DfcConfig['onProgress']) {
  const stats: DfcStats = {
    totalFile: 0,
    totalDir: 0,
    allDirPaths: [],
    allFilePaths: [],
    totalFileSize: 0,
    totalFileHandler: 0,
    totalFileNew: 0,
    totalFileNewSize: 0,
    totalDirNew: 0,
  };
  let preProgressTime = Date.now();

  /**
   * 使用 opendir 流式遍历目录
   * 相比 readdir + map(Promise.all)，这种方式不会一次性加载所有条目到内存
   */
  const walkDir = async (srcDir: string, destDir = ''): Promise<void> => {
    if (isExclude(config, srcDir)) return;

    let dirHandle: Dir | undefined;
    try {
      dirHandle = await promises.opendir(srcDir);
    } catch {
      return; // 无法打开目录（权限等），跳过
    }

    try {
      for await (const entry of dirHandle) {
        const srcPath = resolve(srcDir, entry.name);
        const destPath = destDir ? resolve(destDir, entry.name) : '';

        if (entry.isDirectory()) {
          const info: DfcFileItem = {
            src: srcPath,
            dest: destPath,
            srcStat: {
              isDirectory: true,
              isFile: false,
              atime: new Date(0),
              mtime: new Date(0),
              size: 0,
            },
          };

          if (isExclude(config, srcPath, info.srcStat)) continue;

          stats.totalDir++;
          stats.allDirPaths.push(info);
          await walkDir(srcPath, destPath);
        } else if (entry.isFile()) {
          let fstat: FsStatInfo | undefined;
          try {
            fstat = toFSStatInfo(statSync(srcPath));
          } catch {
            continue;
          }

          if (isExclude(config, srcPath, fstat)) continue;

          stats.totalFile++;
          stats.allFilePaths.push({
            src: srcPath,
            dest: destPath,
            srcStat: fstat,
          });
        }

        // 进度通知（限流）
        const now = Date.now();
        if (onProgress && now - preProgressTime > 500) {
          preProgressTime = now;
          onProgress({ ...stats });
        }
      }
    } finally {
      try {
        await dirHandle?.close();
      } catch {
        // ignore
      }
    }
  };

  await walkDir(_srcDir, _destDir);
  return stats;
}

// ============================================================
// 单线程递归复制
// ============================================================

export async function dirCopyRecursive(config: DfcConfig, src: string, dest: string, onProgress?: (stats: DfcStats) => void) {
  const stats: DfcStats = {
    allFilePaths: [],
    allDirPaths: [],
    totalFile: 0,
    totalFileSize: 0,
    totalFileHandler: 0,
    totalFileNew: 0,
    totalFileNewSize: 0,
    totalDirNew: 0,
    totalDir: 0,
  };

  const handler = async (srcDir: string, destDir: string, srcDirStat?: FsStatInfo) => {
    if (!existsSync(destDir)) {
      cpDir(srcDir, destDir, srcDirStat);
      stats.totalDirNew++;
    }

    const filelist = readdirSync(srcDir, { encoding: 'utf8' });

    for (const filename of filelist) {
      if (!filename || filename === '..') continue;

      onProgress?.(stats);
      const srcPath = resolve(srcDir, filename);
      const destPath = resolve(destDir, filename);

      const srcStat = statSync(srcPath);
      const statInfo = toFSStatInfo(srcStat);
      const check = await checkFile(srcPath, destPath, statInfo, config);

      if (srcStat.isFile()) {
        stats.totalFileHandler++;
        stats.totalFile = stats.totalFileHandler;
        stats.totalFileSize += srcStat.size;
      } else {
        stats.totalDir++;
      }

      if (!check) continue;

      if (check === 'dir') {
        await handler(srcPath, destPath, statInfo);
        if (!readdirSync(destPath).length) {
          rmdirSync(destPath);
          stats.totalDirNew--;
        }
        continue;
      }

      await cpFile(config, srcPath, destPath, statInfo);
      stats.totalFileNew++;
      stats.totalFileNewSize += srcStat.size;
    }

    if (!readdirSync(srcDir).length) {
      await promises.rm(srcDir, { recursive: true, force: true });
    }
  };

  await handler(src, dest);
  stats.totalFile = stats.totalFileHandler;
  return stats;
}

// ============================================================
// 交互式输入
// ============================================================

export function readSyncByRl(tips: string) {
  tips = tips || '> ';

  return new Promise<string>((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(tips, (answer) => {
      resolve(answer.trim());
      rl.close();
    });
  });
}
