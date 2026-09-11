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
  formatProgressPercent,
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
 * 创建 Worker 池的懒加载器
 * 多个批次复用同一个池，避免每个批次重复创建/销毁线程；
 * 若最终走单线程分支，则不会创建任何线程
 */
function createLazyPool(config: DfcConfig) {
  let pool: WorkerPool | null = null;

  return {
    /** 提交一批文件进行复制 */
    submit(filePathList: DfcFileItem[], onProgress?: DfcConfig['onProgress']): Promise<DfcStats> {
      if (!pool) {
        pool = new WorkerPool(config);
        pool.init();
        logPrint(config, color.cyan('已创建子线程池，线程数：'), color.green(pool.getTotalThreads()));
      }
      return pool.submitTasks(filePathList, { onProgress });
    },
    /** 释放线程池 */
    dispose(): void {
      pool?.dispose();
      pool = null;
    },
  };
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
  /**
   * 各批次复制结果的累计值。
   * 不直接累加到 STATS，因为发现阶段结束时会用 Object.assign(STATS, 发现结果) 覆盖 STATS，导致统计丢失。
   */
  const copyTotals = {
    totalDirNew: 0,
    totalFileNew: 0,
    totalFileSize: 0,
    totalFileNewSize: 0,
  };
  /** 累加某个批次的复制结果 */
  const mergeCopyStats = (s: DfcStats) => {
    if (s.totalDirNew) copyTotals.totalDirNew += s.totalDirNew;
    if (s.totalFileNew) copyTotals.totalFileNew += s.totalFileNew;
    if (s.totalFileSize) copyTotals.totalFileSize += s.totalFileSize;
    if (s.totalFileNewSize) copyTotals.totalFileNewSize += s.totalFileNewSize;
  };

  const logProgress = (showPercent = true, s = STATS) => {
    if (config.slient) return;
    const percent = showPercent ? formatProgressPercent(s.totalFileHandler, s.totalFile) : '';
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
      copyTotals.totalDirNew++;
    }

    const onEnd = () => {
      // 将各批次累计的复制结果写回 STATS 后再输出，保证统计准确
      STATS.totalDirNew = copyTotals.totalDirNew;
      STATS.totalFileNew = copyTotals.totalFileNew;
      STATS.totalFileSize = copyTotals.totalFileSize;
      STATS.totalFileNewSize = copyTotals.totalFileNewSize;

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
      mergeCopyStats(stats);
      onEnd();
    } else {
      logPrint(config, color.cyan('开始收集源目录内文件信息'));
      /** 待复制的文件列表 */
      let allFileListTodo: DfcFileItem[] = [];
      /** 已发送给子线程处理的文件数 */
      let sendedToCpFileNum = 0;
      /**
       * 收集过程中启动的复制批次。
       * 必须在收尾前等待其完成，否则进程退出(onEnd 中的 process.exit)会中断未完成的复制，导致文件丢失。
       */
      let pendingBatch: Promise<void> | null = null;

      /** 线程池按需创建，全部批次共用 */
      const pool = createLazyPool(config);

      /** 启动一个复制批次，返回其完成 Promise */
      const runBatch = (list: DfcFileItem[]) =>
        pool
          .submit(list)
          .then(mergeCopyStats)
          .then(() => {
            logPrint(config, color.gray('\n  首批子线程处理完成\n'));
          });

      const discovered = await getAllFiles(config, config.src, config.dest, (s: DfcStats) => {
        logInline(
          config,
          `[${showCostTime(startTime)}] 已发现目录数：${color.cyan(s.totalDir)} 个，包含文件 ${color.cyanBright(s.totalFile)} 个`,
        );

        // 已有批次在执行中则跳过，待其完成后由后续进度回调再次触发
        if (!config.cpDuringStats || pendingBatch) return;

        const minFiles = config.mutiThreadMinFiles || 3000;
        if (s.totalFile <= minFiles) return;

        const todo = s.allFilePaths.slice(sendedToCpFileNum);
        if (todo.length <= minFiles) return;

        sendedToCpFileNum = s.totalFile;
        logPrint(config, color.gray(`\n  数据收集过程中启动线程复制，本次处理文件数：${todo.length}\n`));
        pendingBatch = runBatch(todo).finally(() => {
          pendingBatch = null;
        });
      });
      Object.assign(STATS, discovered);
      allFileListTodo = STATS.allFilePaths.slice(sendedToCpFileNum);

      let tip = `[${showCostTime(startTime)}] 目录预处理完成，发现目录总数：${color.yellow(STATS.totalDir)}，文件总数：${color.yellowBright(
        STATS.totalFile,
      )}`;
      if (config.cpDuringStats && !pendingBatch) {
        tip += `。已处理了 ${color.yellow(copyTotals.totalFileNew)} 个文件`;
      }
      logInline(config, tip);

      const onProgress = (s: DfcStats) => {
        logProgress(true, s);
        config.onProgress?.({
          ...STATS,
          totalFileHandler: s.totalFileHandler,
          totalFileNew: s.totalFileNew,
          totalFileNewSize: s.totalFileNewSize,
          totalFileSize: s.totalFileSize,
          totalDirNew: s.totalDirNew,
        });
      };
      if ((config.threads || 1) < 2 || STATS.totalFile < (config.mutiThreadMinFiles || 3000)) {
        logPrint(config, color.yellow('\n\n单线程执行'));
        // 等待在飞批次完成后再收尾，避免与其并发写入相同的目标文件
        if (pendingBatch) await pendingBatch;
        mergeCopyStats(await fileCopy(config, STATS.allFilePaths, { onProgress }));
      } else {
        // 等待在飞批次完成后再提交最后一批，避免两批并发写入相同的目标文件
        if (pendingBatch) await pendingBatch;
        logPrint(config, color.cyan(`\n\n开始多线程处理，本次处理文件数：${allFileListTodo.length}`));
        mergeCopyStats(await pool.submit(allFileListTodo, onProgress));
      }

      pool.dispose();
      onEnd();
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
