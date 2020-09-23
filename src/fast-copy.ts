/*
 * @Author: lzw
 * @Date: 2020-09-18 09:52:53
 * @LastEditors: lzw
 * @LastEditTime: 2020-09-23 12:03:27
 * @Description: 对指定文件夹内的文件进行复制，只复制指定日期之后创建的文件
 */

import * as workerThreads from 'worker_threads';
import * as fs from 'fs';
import * as path from 'path';
import { color, log } from 'console-log-colors';
const cpus = require('os').cpus().length;

import CONFIG from './config';
import { cpFile, cpDir, fileCopy, showCostTime, dirCopyRecursive, logInline, logPrint, getAllFiles } from './utils';
import { DfcConfig, DfcStats } from '../types';
import { parseConfig } from './parseConfig';

const STATS: DfcStats = {
  allFilePaths: [],
  allDirPaths: [],
  totalFile: 0,
  totalFileHandler: 0,
  totalFileNew: 0,
  totalDir: 0,
  totalDirNew: 0,
};
/** 开始时间 */
let startTime = 0;

/** 打印进度信息 */
function logProgress(showPercent = true) {
  if (CONFIG.slient) return;
  const percent = showPercent ? `[${((100 * STATS.totalFileHandler) / STATS.totalFile).toFixed(2)}%]` : '';
  logInline(
    `[${showCostTime(startTime)}] ${percent} 已处理了${color.yellow(
      STATS.totalFileHandler
    )} 个文件，其中复制了 ${color.yellow(STATS.totalFileNew)} 个文件`
  );
}
/** 简单处理单文件的复制 */
function cpSingleFile(srcFilePath, descFilePath) {
  logPrint('单文件复制');
  if (fs.existsSync(descFilePath) && fs.statSync(descFilePath).isFile()) {
    logPrint('目的文件已存在，将被源文件替换');
  }
  cpFile(srcFilePath, descFilePath);
  logPrint(`复制完成，耗时 ${color.green((Date.now() - startTime) / 1000)} 秒`);
  return true;
}
/** 多线程复制模式 */
function mutiThreadCopy(
  allFilePathList: any[][],
  opts: { onStart?: (threadNum: number) => void; onProgress?: DfcConfig['onProgress']; onEnd?: DfcConfig['onEnd'] } = {}
) {
  const stats: DfcStats = {
    // totalFile: allFilePathList.length,
  };
  /** 线程数 */
  const threadNum = cpus === 2 ? 2 : cpus - 1;
  /** 当前运行的子线程，当为 0 时表示全部执行结束 */
  let threadRuningNum = threadNum;
  const sepCount = Math.ceil(allFilePathList.length / threadNum);
  /** 各子线程的统计信息，以 idx 为 key */
  const threadsStats = {};
  const workerOnData = (worker: workerThreads.Worker, data) => {
    // logPrint(`子线程${idx}发来消息：`, data);
    threadsStats[data.idx] = data;

    stats.totalFileHandler = 0;
    stats.totalFileNew = 0;
    stats.totalDirNew = 0;
    Object.keys(threadsStats).forEach((key) => {
      const item = threadsStats[key];
      stats.totalFileHandler += item.totalFileHandler;
      stats.totalFileNew += item.totalFileNew;
      stats.totalDirNew += item.totalDirNew;
    });

    if (stats.totalFileHandler && 0 === stats.totalFileHandler % 1000) {
      if (opts.onProgress) process.nextTick(() => opts.onProgress(stats));
    }

    if (data.type === 'done') {
      threadRuningNum--;
      if (!threadRuningNum) {
        worker.terminate();
        if (opts.onEnd) process.nextTick(() => opts.onEnd(stats));
      }
    }
  };

  if (opts.onStart) opts.onStart(threadNum);

  const childCfg = { ...CONFIG };
  Object.keys(childCfg).forEach((key) => {
    // postMessage 不能传递函数类型
    if (typeof childCfg[key] === 'function') delete childCfg[key];
  });

  for (let idx = 0; idx < threadNum; idx++) {
    const workerFile = path.resolve(__dirname, './worker.js');
    const worker = new workerThreads.Worker(workerFile, {
      workerData: {
        idx,
        sepCount,
        startTime,
        config: childCfg,
        filePathList: allFilePathList.slice(idx * sepCount, (idx + 1) * sepCount),
      },
    });

    worker.on('message', workerOnData.bind(globalThis, worker));
  }
}

function startMain(_config: typeof CONFIG) {
  startTime = Date.now();
  const cfg = parseConfig(_config);
  if (!cfg) return false;

  // 单文件复制
  if (fs.statSync(cfg.src).isFile()) return cpSingleFile(cfg.src, cfg.desc);

  if (!fs.existsSync(cfg.desc)) {
    cpDir(cfg.src, cfg.desc);
    STATS.totalDirNew++;
  }

  /** 执行完成后回调方法 */
  const onEnd = () => {
    logPrint(
      `\n\n处理完成，总耗时 ${color.green((Date.now() - startTime) / 1000)} 秒！共处理了 ${color.yellow(
        STATS.totalFile
      )} 个文件，包含于 ${color.cyan(STATS.totalDir)} 个文件夹中。其中复制了 ${color.yellow(STATS.totalFileNew)} 个文件`
    );
    // 执行了 ${color.cyan(STATS.totalDirNew)} 次文件夹创建命令 // 由于多线程模式下用了递归创建参数，该值不准确

    if (cfg.onEnd) cfg.onEnd(STATS);
  };

  if (!CONFIG.mutiThread) {
    logPrint(color.cyan('单线程模式'));
    const stats = dirCopyRecursive(cfg.src, cfg.desc, (s) => {
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
    const stats = getAllFiles(cfg.src, cfg.desc, (s) => {
      logInline(`[${showCostTime(startTime)}] 已发现目录数：${s.totalDir} 个，包含文件 ${s.totalFile} 个`);

      // TODO: 可以在获取到文件后立即执行多线程复制
      if (CONFIG.cpDuringStats && isDone && s.totalFile > CONFIG.mutiThreadMinCount) {
        allFileListTodo = s.allFilePaths.slice(sendedToCpFileNum);

        if (allFileListTodo.length > 10000) {
          isDone = false;
          sendedToCpFileNum = s.totalFile;
          mutiThreadCopy(allFileListTodo, {
            onStart: () => {
              logPrint(color.gray('\n\n  数据收集过程中启动线程复制，本次处理文件数：'), allFileListTodo.length, '\n');
            },
            onProgress: (_s) => {
              Object.assign(STATS, _s);
            },
            onEnd: (_s) => {
              Object.assign(STATS, _s);
              logPrint(color.gray(`\n  首批子线程处理完成\n`));
              isDone = true;
            },
          });
        }
      }
    });
    Object.assign(STATS, stats);
    allFileListTodo = STATS.allFilePaths.slice(sendedToCpFileNum);

    let tip = `[${showCostTime(startTime)}] 目录预处理完成，发现文件总数：${color.yellow(
      STATS.totalFile
    )}，目录总数：${color.yellow(STATS.totalDir)}。`;
    if (isDone) {
      tip += `已处理了${color.yellow(STATS.totalFileHandler)} 个文件，其中复制了 ${color.yellow(
        STATS.totalFileNew
      )} 个文件`;
    }
    logInline(tip);

    if (cpus < 2 || STATS.totalFile < CONFIG.mutiThreadMinCount) {
      logPrint(color.yellow('\n\n单线程执行'));
      fileCopy(STATS.allFilePaths, {
        onProgress: (s: DfcStats) => {
          Object.assign(STATS, s);
          logProgress();
          if (cfg.onProgress) cfg.onProgress(STATS);
        },
        onEnd: (s: DfcStats) => {
          Object.assign(STATS, s);
          onEnd();
        },
      });
    } else {
      mutiThreadCopy(allFileListTodo, {
        onStart: (threadNum) => {
          logPrint(color.cyan('\n\n开始多线程处理，线程数：'), color.green(threadNum));
        },
        onProgress: (s: DfcStats) => {
          Object.assign(STATS, s);
          logProgress();
          if (cfg.onProgress) cfg.onProgress(STATS);
        },
        onEnd: (s: DfcStats) => {
          Object.assign(STATS, s);
          onEnd();
        },
      });
    }
  }
  return true;
}

export function fastCopy(cfg: typeof CONFIG) {
  if (workerThreads.isMainThread) return startMain(cfg);
  log.red('只能以主线程模式启动');
  return false;
}
