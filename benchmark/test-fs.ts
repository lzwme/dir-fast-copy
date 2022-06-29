import fs from 'fs';
import * as path from 'path';
import { calcTimeCost, rootDir } from './utils';

export function getAllFilesSync(_srcDir, _destDir = '', onProgress?) {
  const stats = {
      totalFile: 0,
      totalDir: 0,
      allDirPaths: [] as [string, string][],
      allFilePaths: [] as [string, string][],
  };
  const handler = (srcDir, destDir = '') => {
      const filelist = fs.readdirSync(srcDir, { encoding: 'utf8' });
      if (onProgress && stats.totalFile && 0 === stats.totalFile % 500) {
          onProgress(Object.assign({}, stats));
      }
      filelist.forEach((filename) => {
          if (!filename)
              return;
          const srcPath = path.resolve(srcDir, filename);
          const destPath = destDir ? path.resolve(destDir, filename) : '';
          if (!fs.existsSync(srcPath)) return;
          if (fs.statSync(srcPath).isDirectory()) {
              stats.totalDir++;
              stats.allDirPaths.push([srcPath, destPath]);
              return handler(srcPath, destPath);
          }
          else {
              stats.totalFile++;
              stats.allFilePaths.push([srcPath, destPath]);
          }
      });
  };
  handler(_srcDir, _destDir);
  console.log(stats.totalFile);
  return stats;
}

export async function getAllFiles(_srcDir, _destDir = '', onProgress?) {
  const stats = {
      totalFile: 0,
      totalDir: 0,
      allDirPaths: [] as [string, string][],
      allFilePaths: [] as [string, string][],
  };

  const handler = async (srcDir, destDir = '') => {
      const filelist = await fs.promises.readdir(srcDir, { encoding: 'utf8' });
      if (onProgress && stats.totalFile && 0 === stats.totalFile % 500) {
          onProgress(Object.assign({}, stats));
      }

      const list = filelist.map( async (filename) => {
          if (!filename) return;

          const srcPath = path.resolve(srcDir, filename);
          const destPath = destDir ? path.resolve(destDir, filename) : '';
          if (!fs.existsSync(srcPath)) return;

          if ((await fs.promises.stat(srcPath)).isDirectory()) {
              stats.totalDir++;
              stats.allDirPaths.push([srcPath, destPath]);
              return handler(srcPath, destPath);
          } else {
              stats.totalFile++;
              stats.allFilePaths.push([srcPath, destPath]);
          }
      });

      await Promise.all(list);
  }
  await handler(_srcDir, _destDir);
  console.log(stats.totalFile);
  return stats;
}

async function startGetFiles() {
  const src = path.resolve(rootDir, `node_modules/.pnpm`);

  await calcTimeCost(() => getAllFiles(src, 'tmp/test-2'), 'getAllFiles');
  await calcTimeCost(() => getAllFilesSync(src, 'tmp/test-1'), 'getAllFilesSync');
}

// --------------------- fs-copy ----------------

function fsCopy(src: string, dest = 'tmp/fs-cp-ts') {
  return new Promise(rs => {
    fs.cp(src, dest, { recursive: true }, () => rs(true));
  });
}

function fsCopySync(src: string, dest = 'tmp/fs-cpSync-ts') {
  fs.cpSync(src, dest, { recursive: true });
}

function dirCopySync(src: string, dest = 'tmp/dirCopySync') {
  return dirCopyRecursive(src, dest);
}

async function dirCopy(src: string, dest = 'tmp/dirCopy') {
  const stats = {
    totalFile: 0, // 文件总数
    totalFileSize: 0,
    totalFileHandler: 0, // 已处理的文件数
    totalFileNew: 0, // 复制了多少个文件
    totalFileNewSize: 0,
    totalDirNew: 0, // 创建了多少个目录
    totalDir: 0,
  };

  const handler = async (srcDir: string, destDir: string) => {
    if (!fs.existsSync(destDir)) {
      cpDir(srcDir, destDir);
      stats.totalDirNew++;
    }

    const filelist = await fs.promises.readdir(srcDir, { encoding: 'utf8' });
    let srcPath = '';
    let destPath = '';

    for (const filename of filelist) {
      if (!filename || filename === '..') continue;

      srcPath = path.resolve(srcDir, filename);
      destPath = path.resolve(destDir, filename);

      const srcStat = await fs.promises.stat(srcPath);

      if (srcStat.isFile()) {
        stats.totalFileHandler++;
        stats.totalFile = stats.totalFileHandler;
        stats.totalFileSize += srcStat.size;
      } else {
        stats.totalDir++;
      }

      if (srcStat.isDirectory()) {
        await handler(srcPath, destPath);
        // 移除空的文件夹
        if (!(await fs.promises.readdir(destPath)).length) {
          await fs.promises.rmdir(destPath);
          stats.totalDirNew--;
        }
        continue;
      }

      cpFile(srcPath, destPath, srcStat);
      stats.totalFileNew++;
      stats.totalFileNewSize += srcStat.size;
    }
  };

  await handler(src, dest);
  stats.totalFile = stats.totalFileHandler;
  console.log('stats.totalFile', stats.totalFile)
  return stats;
}

/** 单线程模式，执行目录复制（递归） */
export function dirCopyRecursive(src: string, dest: string, onProgress?: (stats) => void) {
  const stats = {
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

      onProgress && onProgress(stats);
      srcPath = path.resolve(srcDir, filename);
      destPath = path.resolve(destDir, filename);

      const srcStat = fs.statSync(srcPath);

      if (srcStat.isFile()) {
        stats.totalFileHandler++;
        stats.totalFile = stats.totalFileHandler;
        stats.totalFileSize += srcStat.size;
      } else {
        stats.totalDir++;
      }

      if (srcStat.isDirectory()) {
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
  console.log('stats.totalFile', stats.totalFile)
  return stats;
}

/** 复制一个文件(不作任何检查以保证速度) */
export function cpFile(srcPath, destPath, srcStat?: fs.Stats) {
  try {
    if (!srcStat) srcStat = fs.statSync(srcPath);
    // fs.writeFileSync(destPath, fs.readFileSync(srcPath));
    fs.createReadStream(srcPath).pipe(fs.createWriteStream(destPath));
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


async function startCopy() {
  const src = path.resolve(rootDir, `node_modules\\.pnpm`);

  await calcTimeCost(() => dirCopySync(src), 'dirCopySync');
  await calcTimeCost(() => dirCopy(src), 'dirCopy');
  await calcTimeCost(() => fsCopySync(src), 'fsCopySync');
  await calcTimeCost(() => fsCopy(src), 'fsCopy');
}

startGetFiles();
startCopy();
