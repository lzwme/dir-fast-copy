import { color } from 'console-log-colors';
import { existsSync, mkdirSync, promises, readdirSync, rmdirSync, statSync, utimes, utimesSync } from 'fs';
import { dirname, resolve } from 'path';
import * as readline from 'readline';
import type { DfcConfig, DfcStats, FsStatInfo } from './type';

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
// 统计对象
// ============================================================

/** 创建空的统计对象 */
export function createEmptyStats(): DfcStats {
  return {
    allFilePaths: [],
    allDirPaths: [],
    totalFile: 0,
    totalFileSize: 0,
    totalFileHandler: 0,
    totalFileNew: 0,
    totalFileNewSize: 0,
    totalDir: 0,
    totalDirNew: 0,
  };
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

/**
 * 计算进度百分比文本
 * @param handled 已处理的文件数
 * @param total 文件总数
 * @returns 形如 `[12.34%]` 的文本；当 total 未确定(<=0)或非有限数时返回空字符串，避免出现 Infinity/NaN
 */
export function formatProgressPercent(handled: number, total: number) {
  if (!Number.isFinite(total) || total <= 0) return '';
  return `[${((100 * handled) / total).toFixed(2)}%]`;
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
  dev?: number;
  ino?: number;
}): FsStatInfo {
  return {
    isFile: fstat.isFile(),
    isDirectory: fstat.isDirectory(),
    nlink: fstat.nlink,
    atime: fstat.atime,
    mtime: fstat.mtime,
    size: fstat.size,
    dev: fstat.dev,
    ino: fstat.ino,
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
    ...createEmptyStats(),
    allFilePaths: filePathList ?? [],
    totalFile: filePathList.length,
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
// 目录遍历（文件发现）
// ============================================================

/** 同层并发的条目数上限：兼顾吞吐(充分利用 libuv 线程池)与内存(Promise 数量) */
const MAX_CONCURRENT_ENTRIES = 256;

/** 计算目录实体标识，用于符号链接环检测 */
function getDirIdentity(fstat: FsStatInfo): string {
  return `${fstat.dev ?? ''}:${fstat.ino ?? ''}`;
}

/**
 * 获取所有需处理的文件列表
 *
 * 两个关键实现要点：
 * 1. 同层并发（而不是逐个串行）：目录读取是异步 IO，同层并发可让 libuv 线程池并行工作。
 *    实测在 7.5 万文件/6900 目录的规模下，串行遍历约 30s，同层并发约 5s。
 * 2. 用 statSync 判断条目类型（而不是 Dirent.isDirectory()）：源目录内可能包含符号链接/
 *    目录联接（Windows 下 pnpm 的 junction），Dirent 对链接返回的 isDirectory/isFile 均为
 *    false，会整体跳过链接指向的内容而导致漏复制；statSync 会跟随链接，与单线程模式一致。
 *
 * 环检测：使用 stat 得到的 dev:ino 作为目录实体标识，沿递归链路比对。
 * 相比 realpath 逐链接解析（实测额外耗时 10s+），它无需任何额外系统调用。
 */
export async function getAllFiles(config: DfcConfig, _srcDir: string, _destDir = '', onProgress?: DfcConfig['onProgress']) {
  const stats: DfcStats = createEmptyStats();
  let preProgressTime = Date.now();

  /** 进度通知（限流），传入快照避免调用方看到遍历过程中的数组变化 */
  const reportProgress = () => {
    const now = Date.now();
    if (onProgress && now - preProgressTime > 500) {
      preProgressTime = now;
      onProgress({
        ...stats,
        allFilePaths: stats.allFilePaths.slice(),
        allDirPaths: stats.allDirPaths.slice(),
      });
    }
  };

  const walkDir = async (srcDir: string, destDir: string, identity: string, ancestors: Set<string>): Promise<void> => {
    // 链接成环：当前目录的实体已出现在递归链路上，终止该分支
    if (identity && ancestors.has(identity)) return;
    if (isExclude(config, srcDir)) return;

    let filelist: string[];
    try {
      filelist = await promises.readdir(srcDir, { encoding: 'utf8' });
    } catch {
      return; // 无法读取目录（权限等），跳过
    }

    const nextAncestors = identity ? new Set(ancestors).add(identity) : ancestors;

    const handleEntry = async (filename: string) => {
      if (!filename) return;

      const srcPath = resolve(srcDir, filename);
      let fstat: FsStatInfo;
      try {
        // 跟随符号链接/联接点，断链或无权访问时跳过
        fstat = toFSStatInfo(statSync(srcPath));
      } catch {
        return;
      }

      if (isExclude(config, srcPath, fstat)) return;

      const destPath = destDir ? resolve(destDir, filename) : '';

      if (fstat.isDirectory) {
        stats.totalDir++;
        stats.allDirPaths.push({ src: srcPath, dest: destPath, srcStat: fstat });
        await walkDir(srcPath, destPath, getDirIdentity(fstat), nextAncestors);
      } else {
        stats.totalFile++;
        stats.allFilePaths.push({ src: srcPath, dest: destPath, srcStat: fstat });
      }

      reportProgress();
    };

    // 分批并发处理同层条目，避免超大目录瞬间创建大量 Promise
    for (let i = 0; i < filelist.length; i += MAX_CONCURRENT_ENTRIES) {
      await Promise.all(filelist.slice(i, i + MAX_CONCURRENT_ENTRIES).map(handleEntry));
    }
  };

  let rootIdentity = '';
  try {
    rootIdentity = getDirIdentity(toFSStatInfo(statSync(_srcDir)));
  } catch {
    return stats; // 源目录不可访问
  }

  await walkDir(_srcDir, _destDir, rootIdentity, new Set());
  return stats;
}

// ============================================================
// 单线程递归复制
// ============================================================

export async function dirCopyRecursive(config: DfcConfig, src: string, dest: string, onProgress?: (stats: DfcStats) => void) {
  const stats: DfcStats = createEmptyStats();

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
