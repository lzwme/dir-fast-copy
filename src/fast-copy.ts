/*
 * @Author: lzw
 * @Date: 2020-09-18 09:52:53
 * @LastEditors: lzw
 * @LastEditTime: 2022-11-02 15:07:26
 * @Description: 对指定文件夹内的文件进行复制，只复制指定日期之后创建的文件
 */

import * as workerThreads from 'worker_threads';
import * as fs from 'fs';
import * as path from 'path';
import { color, log } from 'console-log-colors';
import { CONFIG } from './config';
import {
  cpFile,
  cpDir,
  fileCopy,
  showCostTime,
  dirCopyRecursive,
  logInline,
  logPrint,
  getAllFiles,
  formatFileSize,
  toFSStatInfo,
} from './utils';
import { DfcConfig, DfcStats } from './type';
import { parseConfig } from './parseConfig';

/** 简单处理单文件的复制 */
async function cpSingleFile(srcFilePath, destFilePath) {
  const startTime = Date.now();
  const srcStat = fs.statSync(destFilePath);
  logPrint('单文件复制');
  if (fs.existsSync(destFilePath) && srcStat.isFile()) {
    logPrint('目的文件已存在，将被源文件替换');
  }
  await cpFile(srcFilePath, destFilePath, toFSStatInfo(srcStat));
  logPrint(`复制完成，耗时 ${color.green((Date.now() - startTime) / 1000)} 秒`);
  return true;
}
/** 多线程复制模式 */
function mutiThreadCopy(
  allFilePathList: any[][],
  opts: { startTime?: number; onStart?: (threadNum: number) => void; onProgress?: DfcConfig['onProgress']; onEnd?: DfcConfig['onEnd'] } = {}
) {
  const stats: DfcStats = {
    totalFile: allFilePathList.length,
  };
  /** 当前运行的子线程，当为 0 时表示全部执行结束 */
  let threadRuningNum = CONFIG.threads;
  const sepCount = Math.ceil(allFilePathList.length / CONFIG.threads);
  /** 各子线程的统计信息，以 idx 为 key */
  const threadsStats = {};
  /** 最近一次执行 onProgress 的时间 */
  let preNotifyProgressTime = 0;
  const workerOnData = (worker: workerThreads.Worker, data) => {
    // logPrint(`子线程${idx}发来消息：`, data);
    threadsStats[data.idx] = data;

    if (data.type === 'progress') {
      if (Date.now() - preNotifyProgressTime < CONFIG.progressInterval) return;
      preNotifyProgressTime = Date.now();
    }

    stats.totalFileHandler = 0;
    stats.totalFileNew = 0;
    stats.totalFileNewSize = 0;
    stats.totalFileSize = 0;
    stats.totalDirNew = 0;
    Object.keys(threadsStats).forEach((key) => {
      const item = threadsStats[key];
      stats.totalFileHandler += item.totalFileHandler;
      stats.totalFileNew += item.totalFileNew;
      stats.totalFileNewSize += item.totalFileNewSize;
      stats.totalFileSize += item.totalFileSize;
      stats.totalDirNew += item.totalDirNew;
    });

    if (data.type === 'progress' && opts.onProgress) process.nextTick(() => opts.onProgress(stats));
    // if (stats.totalFileHandler && 0 === stats.totalFileHandler % 1000) {}

    if (data.type === 'done') {
      threadRuningNum--;
      worker.terminate();
      if (!threadRuningNum) {
        if (opts.onEnd) process.nextTick(() => opts.onEnd(stats));
      }
    }
  };

  if (opts.onStart) opts.onStart(CONFIG.threads);

  const childCfg = { ...CONFIG };
  Object.keys(childCfg).forEach((key) => {
    // postMessage 不能传递函数类型
    if (typeof childCfg[key] === 'function') delete childCfg[key];
  });

  for (let idx = 0; idx < CONFIG.threads; idx++) {
    const workerFile = path.resolve(__dirname, './worker.js');
    const workerData = {
      idx,
      sepCount,
      config: childCfg,
      startTime: opts.startTime || Date.now(),
      filePathList: allFilePathList.slice(idx * sepCount, (idx + 1) * sepCount),
    };
    const worker = new workerThreads.Worker(workerFile, { workerData });

    logPrint(`启动子线程 ${idx}，待处理文件数为：`, color.yellow(workerData.filePathList.length));
    worker.on('message', workerOnData.bind(globalThis, worker));
  }
}

async function startMain(_config: typeof CONFIG): Promise<boolean | DfcStats> {
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
  /** 开始时间 */
  const startTime = Date.now();
  /** 打印进度信息 */
  const logProgress = (showPercent = true, s = STATS) => {
    if (CONFIG.slient) return;
    const percent = showPercent ? `[${((100 * s.totalFileHandler) / s.totalFile).toFixed(2)}%]` : '';
    logInline(
      `[${showCostTime(startTime)}] ${percent} 已处理了${color.yellow(s.totalFileHandler)} 个文件，其中复制了 ${color.magenta(
        s.totalFileNew
      )} 个文件${s.totalFileNewSize ? `(${color.magentaBright(formatFileSize(s.totalFileNewSize))})` : ''}`
    );
  };

  const cfg = parseConfig(_config);
  if (!cfg) return STATS;

  // 单文件复制
  if (fs.statSync(cfg.src).isFile()) {
    await cpSingleFile(cfg.src, cfg.dest);
    STATS.totalFileNew = STATS.totalFile = 1;
    return STATS;
  }

  return new Promise(async (resolve) => {
    if (!fs.existsSync(cfg.dest)) {
      cpDir(cfg.src, cfg.dest);
      STATS.totalDirNew++;
    }

    /** 执行完成后回调方法 */
    const onEnd = () => {
      if (CONFIG.deleteSrc === true) {
        STATS.allDirPaths.forEach((dirInfo) => {
          if (fs.existsSync(dirInfo.src) && fs.readdirSync(dirInfo.src).length === 0) fs.rmdirSync(dirInfo.src);
        });
      }

      logInline(
        `\n处理完成，总耗时 ${color.green((Date.now() - startTime) / 1000)} 秒！共处理了 ${color.yellow(STATS.totalFile)} 个文件${
          STATS.totalFileSize ? `(${color.yellowBright(formatFileSize(STATS.totalFileSize))})` : ''
        }，包含于 ${color.cyan(STATS.totalDir)} 个文件夹中。其中复制了 ${color.magenta(STATS.totalFileNew)} 个文件${
          STATS.totalFileNewSize ? `(${color.magentaBright(formatFileSize(STATS.totalFileNewSize))})` : ''
        }\n`
      );
      // 执行了 ${color.cyan(STATS.totalDirNew)} 次文件夹创建命令 // 由于多线程模式下用了递归创建参数，该值不准确

      if (cfg.onEnd) cfg.onEnd(STATS);
      resolve(STATS);
    };

    if (+CONFIG.threads < 2) {
      logPrint(color.cyan('单线程模式'));
      /** 最近一次执行 onProgress 的时间 */
      let preNotifyProgressTime = 0;
      const stats = dirCopyRecursive(cfg.src, cfg.dest, (s) => {
        if (Date.now() - preNotifyProgressTime < CONFIG.progressInterval) return;
        preNotifyProgressTime = Date.now();
        Object.assign(STATS, s);
        logProgress(false);
      });
      Object.assign(STATS, stats);
      onEnd();
    } else {
      logPrint(color.cyan('开始收集源目录内文件信息'));
      /** 待复制的文件列表 */
      let allFileListTodo = [];
      /** 已发送给子线程处理的文件数 */
      let sendedToCpFileNum = 0;
      /** 子线程是否已处理完毕 */
      let isDone = true;
      const stats = await getAllFiles(cfg.src, cfg.dest, (s) => {
        logInline(`[${showCostTime(startTime)}] 已发现目录数：${color.cyan(s.totalDir)} 个，包含文件 ${color.cyanBright(s.totalFile)} 个`);

        // TODO: 可以在获取到文件后立即执行多线程复制
        if (CONFIG.cpDuringStats && isDone && s.totalFile > CONFIG.mutiThreadMinFiles) {
          allFileListTodo = s.allFilePaths.slice(sendedToCpFileNum);

          if (allFileListTodo.length > CONFIG.mutiThreadMinFiles) {
            isDone = false;
            sendedToCpFileNum = s.totalFile;
            mutiThreadCopy(allFileListTodo, {
              startTime,
              onStart: () => {
                logPrint(color.gray('\n\n  数据收集过程中启动线程复制，本次处理文件数：'), allFileListTodo.length, '\n');
              },
              // onProgress: (s) => logProgress(true, s),
              onEnd: (s) => {
                // 只记录复制了的文件和文件夹，因为他们还会在后面被处理
                ['totalDirNew', 'totalFileNew', 'totalFileSize', 'totalFileNewSize'].forEach((key) => {
                  if (s[key]) STATS[key] += s[key];
                });
                logPrint(color.gray(`\n  首批子线程处理完成\n`));
                isDone = true;
              },
            });
          }
        }
      });
      Object.assign(STATS, stats);
      allFileListTodo = STATS.allFilePaths.slice(sendedToCpFileNum);

      let tip = `[${showCostTime(startTime)}] 目录预处理完成，发现目录总数：${color.yellow(STATS.totalDir)}，文件总数：${color.yellowBright(
        STATS.totalFile
      )}`;
      if (CONFIG.cpDuringStats && isDone) {
        tip += `。已处理了${color.yellow(STATS.totalFileHandler)} 个文件，其中复制了 ${color.magenta(STATS.totalFileNew)} 个文件`;
      }
      logInline(tip);

      const onProgress = (s: DfcStats) => {
        logProgress(true, s);
        if (cfg.onProgress) cfg.onProgress(STATS);
      };
      const onEndCallback = (s: DfcStats) => {
        ['totalDirNew', 'totalFileNew', 'totalFileSize', 'totalFileNewSize'].forEach((key) => {
          if (s[key]) STATS[key] += s[key];
        });
        onEnd();
      };

      if (CONFIG.threads < 2 || STATS.totalFile < CONFIG.mutiThreadMinFiles) {
        logPrint(color.yellow('\n\n单线程执行'));
        fileCopy(STATS.allFilePaths, {
          onProgress,
          onEnd: onEndCallback,
        });
      } else {
        mutiThreadCopy(allFileListTodo, {
          startTime,
          onStart: (threadNum) => {
            logPrint(color.cyan('\n\n开始多线程处理，线程数：'), color.green(threadNum));
          },
          onProgress,
          onEnd: onEndCallback,
        });
      }
    }
  });
}

export async function fastCopy(cfg: typeof CONFIG) {
  if (workerThreads.isMainThread) return startMain(cfg);
  log.red('只能以主线程模式启动');
  return false;
}
