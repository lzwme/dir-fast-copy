/*
 * @Author: lzw
 * @Date: 2020-09-18 09:52:53
 * @LastEditors: lzw
 * @LastEditTime: 2020-09-22 21:17:48
 * @Description: 对指定文件夹内的文件进行复制，只复制指定日期之后创建的文件
 */

import * as workerThreads from 'worker_threads';
import * as fs from 'fs';
import * as path from 'path';
import { color, log } from 'console-log-colors';

import CONFIG from './config';
import { cpFile, cpDir, fileCopy, showCostTime, dirCopyRecursive, logInline, logPrint, getAllFiles } from './utils';
import { DfcStats } from '../types';
import { parseConfig } from './parseConfig';

const STATS: DfcStats = {
  allFilePaths: {},
  allDirPaths: {},
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
    `[${showCostTime(startTime)}] ${percent} 已处理了${STATS.totalFileHandler}个文件，其中复制了 ${
      STATS.totalFileNew
    } 个文件`
  );
}
/** 简单处理单文件复制的情况 */
function cpSingleFile(srcFilePath, descFilePath) {
  logPrint('单文件复制');
  if (fs.existsSync(descFilePath) && fs.statSync(descFilePath).isFile()) {
    logPrint('目的文件已存在，将被源文件替换');
  }
  cpFile(srcFilePath, descFilePath);
  logPrint(`复制完成，耗时 ${color.green((Date.now() - startTime) / 1000)} 秒`);
  return true;
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
    const stats = getAllFiles(cfg.src, cfg.desc, startTime);
    Object.assign(STATS, stats);

    logInline(
      `[${showCostTime(startTime)}] 目录预处理完成，发现文件总数：${color.yellow(
        STATS.totalFile
      )}，目录总数：${color.yellow(STATS.totalDir)}`
    );

    const cpus = require('os').cpus().length;
    const allFilePathList = Object.entries(STATS.allFilePaths);

    if (cpus < 2 || STATS.totalFile < CONFIG.mutiThreadMinCount) {
      logPrint(color.yellow('\n\n单线程执行'));
      fileCopy(allFilePathList, {
        onProgress: (_stats: DfcStats) => {
          Object.assign(STATS, _stats);
          logProgress();
          if (cfg.onProgress) cfg.onProgress(STATS);
        },
        onEnd: (_stats: DfcStats) => {
          Object.assign(STATS, _stats);
          onEnd();
        },
      });
    } else {
      /** 线程数 */
      const threadNum = cpus === 2 ? 2 : cpus - 1;
      /** 当前运行的子线程，当为 0 时表示全部执行结束 */
      let threadRuningNum = threadNum;
      const sepCount = Math.ceil(STATS.totalFile / threadNum);
      /** 各子线程的统计信息，以 idx 为 key */
      const threadsStats = {};
      const workerOnData = (data) => {
        // logPrint(`子线程${idx}发来消息：`, data);
        threadsStats[data.idx] = data;

        STATS.totalFileHandler = 0;
        STATS.totalFileNew = 0;
        STATS.totalDirNew = 0;
        Object.keys(threadsStats).forEach((key) => {
          const item = threadsStats[key];
          STATS.totalFileHandler += item.totalFileHandler;
          STATS.totalFileNew += item.totalFileNew;
          STATS.totalDirNew += item.totalDirNew;
        });

        process.nextTick(() => {
          if (STATS.totalFileHandler && 0 === STATS.totalFileHandler % 1000) {
            logProgress();
            if (cfg.onProgress) cfg.onProgress(STATS);
          }
        });

        if (data.type === 'done') {
          threadRuningNum--;
          if (!threadRuningNum) {
            // worker.terminate();
            process.nextTick(() => onEnd());
          }
        }
      };

      logPrint(color.cyan('\n\n开始多线程处理，线程数：'), color.green(threadNum));

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

        worker.on('message', workerOnData);
      }
    }
  }
  return true;
}

export function fastCopy(cfg: typeof CONFIG) {
  if (workerThreads.isMainThread) return startMain(cfg);
  log.red('只能以主线程模式启动');
  return false;
}
