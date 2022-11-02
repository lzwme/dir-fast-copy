import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import CONFIG from './config';
import { log, color } from 'console-log-colors';
import type { DfcConfig, DfcStats, FsStatInfo } from './type';
const pkg = require('../package.json');

export function help() {
  log.green(pkg.description);
  console.log(`\r\n ${color.yellow('USEAGE:')}  dfc cf <src> <dest>`);
}

/** 日志打印 */
export function logPrint(...args) {
  if (CONFIG.slient) return;
  console.log(...args);
}

/** 执行文件复制（获取到全部文件后） */
export async function fileCopy(
  filePathList: DfcStats['allFilePaths'],
  opts: { onProgress?: DfcConfig['onProgress']; onEnd?: DfcConfig['onEnd'] } = {}
) {
  const stats: DfcStats = {
    totalFile: filePathList.length,
    totalFileSize: 0,
    totalFileHandler: 0,
    totalFileNew: 0,
    totalFileNewSize: 0,
    totalDirNew: 0,
  };

  if (!filePathList) return stats;
  const progressTipNum = filePathList.length > 10000 ? 1000 : 100;
  const queueSize = 5;
  let cpFileQueue: Promise<void>[] = [];

  for (const item of filePathList) {
    const { src: srcPath, dest: destPath, srcStat } = item;
    const check = checkFile(srcPath, destPath, srcStat);

    stats.totalFileHandler++;

    if (stats.totalFileHandler > 1 && 0 === stats.totalFileHandler % progressTipNum) {
      if (opts.onProgress) opts.onProgress(stats);
    }

    if (check === 'dir') continue;
    stats.totalFileSize += srcStat.size;
    if (check === false) continue;

    try {
      // 创建目的文件的目录路径
      const destFileDir = path.dirname(destPath);
      if (!fs.existsSync(destFileDir)) {
        cpDir(path.dirname(srcPath), destFileDir, srcStat);
        stats.totalDirNew++;
      }

      if (cpFileQueue.length >= queueSize) {
        await Promise.allSettled(cpFileQueue);
        cpFileQueue = [];
      }

      cpFileQueue.push(cpFile(srcPath, destPath, srcStat));
      stats.totalFileNew++;
      stats.totalFileNewSize += srcStat.size;
    } catch (err) {
      console.log(`文件复制失败:\nsrc: ${srcPath}\ndest: ${destPath}\n`, err);
    }
  }

  await Promise.allSettled(cpFileQueue);

  if (opts.onEnd) opts.onEnd(stats);
  return stats;
}

export function formatTime(timeMs) {
  // return timeMs / 1000 + 's';
  return new Date(new Date('1970-01-01T00:00:00').getTime() + timeMs).toTimeString().split(' ')[0];
}

/** 显示从指定的时间到此刻花费的时间 */
export function showCostTime(startTime: number) {
  return color.cyan(formatTime(Date.now() - startTime));
}

export function isExclude(srcFilePath: string) {
  for (const d of CONFIG.exclude) {
    if (d instanceof RegExp) {
      if (srcFilePath.match(d)) return true;
    } else {
      if (srcFilePath.includes(d)) return false;
    }
  }

  return false;
}

/**
 * 文件校验
 * @returns
 * 返回 null 表示文件或目录被忽略
 * 返回 false 表示文件或目录不执行处理
 */
export function checkFile(srcFilePath: string, destFilePath: string, srcStat: FsStatInfo, config = CONFIG) {
  // console.debug('checkFile:', srcFilePath, destFilePath);
  if (isExclude(srcFilePath)) return false;

  if (srcStat.isDirectory) return 'dir';

  if (srcStat.mtime.getTime() < config.minDateTime) return false;

  // 相同大小的文件已存在
  if (config.skipSameFile) {
    if (fs.existsSync(destFilePath) && fs.statSync(destFilePath).size === srcStat.size) return false;
  }

  return srcStat;
}


/** 复制一个文件 */
export async function cpFileSync(srcPath, destPath, srcStat: FsStatInfo) {
  try {
    fs.writeFileSync(destPath, fs.readFileSync(srcPath));
    fs.utimesSync(destPath, srcStat.atime, srcStat.mtime);
  } catch (err) {
    console.log(`文件复制失败:\nsrc: ${srcPath}\ndest: ${destPath}\n`, err);
  }
}

/** 复制一个文件(异步) */
export async function cpFile(srcPath, destPath, srcStat: FsStatInfo) {
  try {
    await new Promise((rs, reject) => {
      fs.createReadStream(srcPath).pipe(fs.createWriteStream(destPath)).on('close', () => {
        fs.utimes(destPath, srcStat.atime, srcStat.mtime, (err) => {
          if (err) reject(err);
          else rs(true)
        });
      });
    });
  } catch (err) {
    console.log(`文件复制失败:\nsrc: ${srcPath}\ndest: ${destPath}\n`, err);
  }
}

/** 复制一个目录(不作任何检查以保证速度) */
export function cpDir(srcDir, destDir, srcStat?: FsStatInfo) {
  try {
    if (!srcStat) srcStat = toFSStatInfo(fs.statSync(srcDir));
    fs.mkdirSync(destDir, { recursive: true });
    fs.utimesSync(destDir, srcStat.atime, srcStat.mtime);
  } catch (err) {
    console.log(`目录复制失败:\nsrc: ${srcDir}\ndest: ${destDir}\n`, err);
  }
}

export function toFSStatInfo(fstat: fs.Stats) {
  const info: FsStatInfo = {
    isFile: fstat.isFile(),
    isDirectory: fstat.isDirectory(),
    nlink: fstat.nlink,
    atime: fstat.atime,
    mtime: fstat.mtime,
    size: fstat.size,
  };
  return info;
}

/** 在当前行打印日志信息(主要用于显示进度信息) */
export function logInline(msg) {
  if (CONFIG.slient) return;
  // console.log(msg);
  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);
  process.stdout.write(msg, 'utf-8');
}

/** 获取所有需处理的文件列表（后续分割为多线程处理） */
export async function getAllFiles(_srcDir: string, _destDir = '', onProgress?: typeof CONFIG['onProgress']) {
  const stats: DfcStats = {
    totalFile: 0,
    totalDir: 0,
    allDirPaths: [],
    allFilePaths: [],
  };
  let preProgressTime = Date.now();

  const handler = async (srcDir: string, destDir = '') => {
    if (isExclude(srcDir)) return false;

    const filelist = await fs.promises.readdir(srcDir, { encoding: 'utf8' });
    const now = Date.now();

    if (onProgress && now - preProgressTime > 500) {
      preProgressTime = now;
      onProgress(Object.assign({}, stats));
    }

    const list = filelist.map(async (filename) => {
      if (!filename) return;

      const srcPath = path.resolve(srcDir, filename);
      const destPath = destDir ? path.resolve(destDir, filename) : '';
      if (!fs.existsSync(srcPath)) return;

      if (isExclude(srcPath)) return;

      const fstat = await fs.promises.stat(srcPath);

      const info: DfcStats['allDirPaths'][0] = {
        src: srcPath,
        dest: destPath,
        srcStat: toFSStatInfo(fstat),
      };

      if (fstat.isDirectory()) {
        stats.totalDir++;
        stats.allDirPaths.push(info);
        return handler(srcPath, destPath);
      } else {
        stats.totalFile++;
        stats.allFilePaths.push(info);
      }
    });

    return Promise.all(list);
  };

  await handler(_srcDir, _destDir);
  return stats;
}

/** 单线程模式，执行目录复制（递归） */
export function dirCopyRecursive(src: string, dest: string, onProgress?: (stats) => void) {
  const stats: DfcStats = {
    totalFile: 0, // 文件总数
    totalFileSize: 0,
    totalFileHandler: 0, // 已处理的文件数
    totalFileNew: 0, // 复制了多少个文件
    totalFileNewSize: 0,
    totalDirNew: 0, // 创建了多少个目录
    totalDir: 0,
  };

  const handler = (srcDir: string, destDir: string, srcDirStat?: FsStatInfo) => {
    if (!fs.existsSync(destDir)) {
      cpDir(srcDir, destDir, srcDirStat);
      stats.totalDirNew++;
    }

    const filelist = fs.readdirSync(srcDir, { encoding: 'utf8' });
    let srcPath = '';
    let destPath = '';

    filelist.forEach((filename) => {
      if (!filename || filename === '..') return;

      onProgress && onProgress(stats);
      srcPath = path.resolve(srcDir, filename);
      destPath = path.resolve(destDir, filename);

      const srcStat = fs.statSync(srcPath);
      const statInfo = toFSStatInfo(srcStat);
      const check = checkFile(srcPath, destPath, statInfo);

      if (srcStat.isFile()) {
        stats.totalFileHandler++;
        stats.totalFile = stats.totalFileHandler;
        stats.totalFileSize += srcStat.size;
      } else {
        stats.totalDir++;
      }

      if (!check) return;

      if (check === 'dir') {
        handler(srcPath, destPath, statInfo);
        // 移除空的文件夹
        if (!fs.readdirSync(destPath).length) {
          fs.rmdirSync(destPath);
          stats.totalDirNew--;
        }
        return;
      }

      cpFileSync(srcPath, destPath, statInfo);
      stats.totalFileNew++;
      stats.totalFileNewSize += srcStat.size;
    });
  };

  handler(src, dest);
  stats.totalFile = stats.totalFileHandler;
  return stats;
}

/** 等待并获取用户输入内容 */
export function readSyncByRl(tips: string) {
  tips = tips || '> ';

  return new Promise((resolve) => {
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

export function formatFileSize(size: number) {
  if (size > 1 << 30) return (size / (1 << 30)).toFixed(2) + 'G';
  if (size > 1 << 20) return (size / (1 << 20)).toFixed(2) + 'M';
  if (size > 1 << 10) return (size / (1 << 10)).toFixed(2) + 'KB';
  return size + 'B';
}
