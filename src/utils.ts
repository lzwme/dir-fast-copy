import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import CONFIG from './config';
import { log, color } from 'console-log-colors';
import { DfcStats } from '../types';
import { DfcConfig } from '../types/index';
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
export function fileCopy(filePathList: string[][], opts: { onProgress?: DfcConfig['onProgress']; onEnd?: DfcConfig['onEnd'] } = {}) {
  const stats: DfcStats = {
    totalFile: filePathList.length,
    totalFileSize: 0,
    totalFileHandler: 0,
    totalFileNew: 0,
    totalFileNewSize: 0,
    totalDirNew: 0,
  };

  if (!filePathList) return;
  const progressTipNum = filePathList.length > 10000 ? 1000 : 100;

  filePathList.forEach((item, idx) => {
    const [srcPath, destPath] = item;
    const srcStat = fs.statSync(srcPath);
    const check = checkFile(srcPath, destPath, srcStat);

    stats.totalFileHandler = idx + 1;

    if (idx && 0 === stats.totalFileHandler % progressTipNum) {
      if (opts.onProgress) opts.onProgress(stats);
    }

    if (check === 'dir') return;
    stats.totalFileSize += srcStat.size;

    if (check === false) return;

    try {
      // 创建目的文件的目录路径
      const destFileDir = path.dirname(destPath);
      if (!fs.existsSync(destFileDir)) {
        cpDir(path.dirname(srcPath), destFileDir);
        stats.totalDirNew++;
      }

      cpFile(srcPath, destPath);
      // logPrint('cpFile:', srcPath, destPath);
      stats.totalFileNew++;
      stats.totalFileNewSize += srcStat.size;
    } catch (err) {
      console.log(`文件复制失败:\nsrc: ${srcPath}\ndest: ${destPath}\n`, err);
    }
  });

  if (opts.onEnd) opts.onEnd(stats);
}

export function formatTime(timeMs) {
  // return timeMs / 1000 + 's';
  return new Date(new Date('2010-01-01T00:00:00').getTime() + timeMs).toTimeString().split(' ')[0];
}

/** 显示从指定的时间到此刻花费的时间 */
export function showCostTime(startTime: number) {
  return color.cyan(formatTime(Date.now() - startTime));
}

/**
 * 文件校验
 * @returns
 * 返回 null 表示文件或目录被忽略
 * 返回 false 表示文件或目录不执行处理
 */
export function checkFile(_srcFilePath, destFilePath, srcStat: fs.Stats, config = CONFIG) {
  if (config.exclude.some((d) => d.test(_srcFilePath))) return null;

  if (srcStat.isDirectory()) return 'dir';

  if (srcStat.mtimeMs < config.minDateTime) return false;

  // 相同大小的文件已存在
  if (config.skipSameFile) {
    if (fs.existsSync(destFilePath) && fs.statSync(destFilePath).size === srcStat.size) return false;
  }

  return srcStat;
}

/** 复制一个文件(不作任何检查以保证速度) */
export function cpFile(srcPath, destPath, srcStat?: fs.Stats) {
  try {
    if (!srcStat) srcStat = fs.statSync(srcPath);
    fs.writeFileSync(destPath, fs.readFileSync(srcPath));
    fs.utimesSync(destPath, srcStat.atime, srcStat.mtime);
    //   totalFileNew++;
  } catch (err) {
    console.log(`文件复制失败:\nsrc: ${srcPath}\ndest: ${destPath}\n`, err);
  }
}

/** 复制一个目录(不作任何检查以保证速度) */
export function cpDir(srcDir, destDir, srcStat?: fs.Stats) {
  try {
    if (!srcStat) srcStat = fs.statSync(srcDir);
    fs.mkdirSync(destDir, { recursive: true });
    fs.utimesSync(destDir, srcStat.atime, srcStat.mtime);
  } catch (err) {
    console.log(`文件复制失败:\nsrc: ${srcDir}\ndest: ${destDir}\n`, err);
  }
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
export function getAllFiles(_srcDir: string, _destDir = '', onProgress?: typeof CONFIG['onProgress']) {
  const stats: DfcStats = {
    totalFile: 0,
    totalDir: 0,
    allDirPaths: [],
    allFilePaths: [],
  };

  const handler = (srcDir, destDir = '') => {
    const filelist = fs.readdirSync(srcDir, { encoding: 'utf8' });

    if (onProgress && stats.totalFile && 0 === stats.totalFile % 500) {
      onProgress(Object.assign({}, stats));
    }

    filelist.forEach((filename) => {
      if (!filename) return;

      const srcPath = path.resolve(srcDir, filename);
      const destPath = destDir ? path.resolve(destDir, filename) : '';

      if (fs.statSync(srcPath).isDirectory()) {
        stats.totalDir++;
        stats.allDirPaths.push([srcPath, destPath]);
        return handler(srcPath, destPath);
      } else {
        stats.totalFile++;
        stats.allFilePaths.push([srcPath, destPath]);
      }
    });
  };

  handler(_srcDir, _destDir);
  return stats;
}

/** 单线程模式，执行目录复制（递归） */
export function dirCopyRecursive(src: string, dest: string, onProgress: (stats) => void) {
  const stats: DfcStats = {
    totalFile: 0, // 文件总数
    totalFileSize: 0,
    totalFileHandler: 0, // 已处理的文件数
    totalFileNew: 0, // 复制了多少个文件
    totalFileNewSize: 0,
    totalDirNew: 0, // 创建了多少个目录
    totalDir: 0,
  };

  const handler = (srcDir: string, destDir: string) => {
    if (!fs.existsSync(destDir)) {
      cpDir(srcDir, destDir);
      stats.totalDirNew++;
    }

    const filelist = fs.readdirSync(srcDir, { encoding: 'utf8' });
    let srcPath = '';
    let destPath = '';

    filelist.forEach((filename) => {
      if (!filename || filename === '..') return;

      onProgress(stats);
      srcPath = path.resolve(srcDir, filename);
      destPath = path.resolve(destDir, filename);

      const srcStat = fs.statSync(srcPath);
      const check = checkFile(srcPath, destPath, srcStat);

      if (srcStat.isFile()) {
        stats.totalFileHandler++;
        stats.totalFile = stats.totalFileHandler;
        stats.totalFileSize += srcStat.size;
      } else {
        stats.totalDir++;
      }

      if (!check) return;

      if (check === 'dir') {
        handler(srcPath, destPath);
        // 移除空的文件夹
        if (!fs.readdirSync(destPath).length) {
          fs.rmdirSync(destPath);
          stats.totalDirNew--;
        }
        return;
      }

      cpFile(srcPath, destPath, srcStat);
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
