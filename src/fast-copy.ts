/*
 * @Author: lzw
 * @Date: 2020-09-18 09:52:53
 * @LastEditors: renxia
 * @LastEditTime: 2024-08-06
 * @Description: 对指定文件夹内的文件进行复制，只复制指定日期之后创建的文件
 */

import { color } from 'console-log-colors';
import * as fs from 'fs';
import * as path from 'path';
import * as workerThreads from 'worker_threads';
import { parseConfig } from './parseConfig';
import type { DfcConfig, DfcFileItem, DfcStats } from './type';
import {
  cpDir,
  cpFile,
  dirCopyRecursive,
  fileCopy,
  formatFileSize,
  getAllFiles,
  logInline,
  logPrint,
  showCostTime,
  toFSStatInfo,
} from './utils';
import { WorkerPool } from './worker-pool';

/** 从指定目录开始，递归删除所有空的子目录（含自身） */
function removeEmptyDirs(dirPath: string) {
  if (!fs.existsSync(dirPath)) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      removeEmptyDirs(path.join(dirPath, entry.name));
    }
  }

  try {
    if (fs.readdirSync(dirPath).length === 0) fs.rmdirSync(dirPath);
  } catch {
    // 目录非空或删除失败时忽略
  }
}

/** 简单处理单文件的复制 */
async function cpSingleFile(config: DfcConfig, srcFilePath: string, destFilePath: string) {
  const startTime = Date.now();
  const srcStat = fs.statSync(srcFilePath);
  logPrint(config, '单文件复制');
  if (fs.existsSync(destFilePath) && srcStat.isFile()) {
    logPrint(config, '目的文件已存在，将被源文件替换');
  }
  await cpFile(config, srcFilePath, destFilePath, toFSStatInfo(srcStat));
  logPrint(config, `复制完成，耗时 ${color.green((Date.now() - startTime) / 1000)} 秒`);
  return true;
}

/**
 * 使用 WorkerPool 执行多线程复制
 */
function mutiThreadCopyWithPool(
  config: DfcConfig,
  allFilePathList: DfcFileItem[],
  opts: {
    startTime?: number;
    onProgress?: DfcConfig['onProgress'];
    onEnd?: (stats: DfcStats) => void;
  } = {},
) {
  const pool = new WorkerPool(config, {
    startTime: opts.startTime,
    onProgress: opts.onProgress ?? undefined,
    onAllDone: (stats) => {
      pool.dispose();
      opts.onEnd?.(stats);
    },
  });

  pool.init();
  pool.submitTasks(allFilePathList);
}

async function startMain(config: DfcConfig): Promise<boolean | DfcStats> {
  const STATS: DfcStats = {
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
  const startTime = Date.now();

  const logProgress = (showPercent = true, s = STATS) => {
    if (config.slient) return;
    const percent = showPercent ? `[${((100 * s.totalFileHandler) / s.totalFile).toFixed(2)}%]` : '';
    logInline(
      config,
      `[${showCostTime(startTime)}] ${percent} 已处理了${color.yellow(s.totalFileHandler)} 个文件，其中复制了 ${color.magenta(
        s.totalFileNew,
      )} 个文件${s.totalFileNewSize ? `(${color.magentaBright(formatFileSize(s.totalFileNewSize))})` : ''}`,
    );
  };

  // 单文件复制
  if (fs.statSync(config.src).isFile()) {
    await cpSingleFile(config, config.src, config.dest);
    STATS.totalFileNew = STATS.totalFile = 1;
    return STATS;
  }

  return new Promise(async (resolve) => {
    if (!fs.existsSync(config.dest)) {
      cpDir(config.src, config.dest);
      STATS.totalDirNew++;
    }

    const onEnd = () => {
      if (config.deleteSrc === true) {
        for (let i = STATS.allDirPaths.length - 1; i >= 0; i--) {
          const dirInfo = STATS.allDirPaths[i];
          if (fs.existsSync(dirInfo.src) && fs.readdirSync(dirInfo.src).length === 0) fs.rmdirSync(dirInfo.src);
        }
        removeEmptyDirs(config.src);
      }

      logInline(
        config,
        `\n处理完成，总耗时 ${color.green((Date.now() - startTime) / 1000)} 秒！共处理了 ${color.yellow(STATS.totalFile)} 个文件${
          STATS.totalFileSize ? `(${color.yellowBright(formatFileSize(STATS.totalFileSize))})` : ''
        }，包含于 ${color.cyan(STATS.totalDir)} 个文件夹中。其中复制了 ${color.magenta(STATS.totalFileNew)} 个文件${
          STATS.totalFileNewSize ? `(${color.magentaBright(formatFileSize(STATS.totalFileNewSize))})` : ''
        }\n`,
      );

      config.onEnd?.(STATS);
      resolve(STATS);
    };

    if ((config.threads || 1) < 2) {
      logPrint(config, color.cyan('单线程模式'));
      let preNotifyProgressTime = 0;
      const stats = await dirCopyRecursive(config, config.src, config.dest, (s) => {
        if (Date.now() - preNotifyProgressTime < (config.progressInterval || 0)) return;
        preNotifyProgressTime = Date.now();
        Object.assign(STATS, s);
        logProgress(false);
      });
      Object.assign(STATS, stats);
      onEnd();
    } else {
      logPrint(config, color.cyan('开始收集源目录内文件信息'));
      let allFileListTodo: DfcFileItem[] = [];
      let sendedToCpFileNum = 0;
      let isDone = true;
      const stats = await getAllFiles(config, config.src, config.dest, (s: DfcStats) => {
        logInline(
          config,
          `[${showCostTime(startTime)}] 已发现目录数：${color.cyan(s.totalDir)} 个，包含文件 ${color.cyanBright(s.totalFile)} 个`,
        );

        if (config.cpDuringStats && isDone && s.totalFile > (config.mutiThreadMinFiles || 3000)) {
          allFileListTodo = s.allFilePaths.slice(sendedToCpFileNum);

          if (allFileListTodo.length > (config.mutiThreadMinFiles || 3000)) {
            isDone = false;
            sendedToCpFileNum = s.totalFile;
            mutiThreadCopyWithPool(config, allFileListTodo, {
              startTime,
              onEnd: (s) => {
                for (const key of ['totalDirNew', 'totalFileNew', 'totalFileSize', 'totalFileNewSize'] as const) {
                  if (s[key]) STATS[key] += s[key];
                }
                logPrint(config, color.gray('\n  首批子线程处理完成\n'));
                isDone = true;
              },
            });
          }
        }
      });
      Object.assign(STATS, stats);
      allFileListTodo = STATS.allFilePaths.slice(sendedToCpFileNum);

      let tip = `[${showCostTime(startTime)}] 目录预处理完成，发现目录总数：${color.yellow(STATS.totalDir)}，文件总数：${color.yellowBright(
        STATS.totalFile,
      )}`;
      if (config.cpDuringStats && isDone) {
        tip += `。已处理了 ${color.yellow(STATS.totalFileHandler)} 个文件，其中复制了 ${color.magenta(STATS.totalFileNew)} 个文件`;
      }
      logInline(config, tip);

      const onProgress = (s: DfcStats) => {
        logProgress(true, s);
        config.onProgress?.(STATS);
      };
      const onEndCallback = (s: DfcStats) => {
        for (const key of ['totalDirNew', 'totalFileNew', 'totalFileSize', 'totalFileNewSize'] as const) {
          if (s[key]) STATS[key] += s[key];
        }
        onEnd();
      };

      if ((config.threads || 1) < 2 || STATS.totalFile < (config.mutiThreadMinFiles || 3000)) {
        logPrint(config, color.yellow('\n\n单线程执行'));
        await fileCopy(config, STATS.allFilePaths, {
          onProgress,
          onEnd: onEndCallback,
        });
      } else {
        mutiThreadCopyWithPool(config, allFileListTodo, {
          startTime,
          onProgress,
          onEnd: onEndCallback,
        });
      }
    }
  });
}

export async function fastCopy(cfg: DfcConfig) {
  if (!workerThreads.isMainThread) {
    console.log(color.red('只能以主线程模式启动'));
    return false;
  }

  const config = parseConfig(cfg);
  if (!config) return false;

  return startMain(config);
}
