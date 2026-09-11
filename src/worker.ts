/*
 * @Author: lzw
 * @Date: 2020-09-18 09:52:53
 * @LastEditors: lzw
 * @LastEditTime: 2024-08-06
 * @Description: 子线程 worker（池模式：常驻并循环接收任务）
 */
import { isMainThread, parentPort, workerData } from 'worker_threads';
import { createDefaultConfig } from './config';
import type { DfcConfig, DfcStats } from './type';
import { fileCopy } from './utils';

/** 任务消息 */
interface TaskMessage {
  type: 'task';
  taskId: number;
  batchId: number;
  filePathList: Parameters<typeof fileCopy>[1];
}

/**
 * 上报的消息：只回传统计标量。
 * 统计对象中包含 allFilePaths/allDirPaths 等大数组，若整体回传，
 * 每次消息都要对数千个对象做结构化克隆，开销极大。
 */
function pickStats(stats: DfcStats) {
  return {
    allFilePaths: [],
    allDirPaths: [],
    totalFile: stats.totalFile,
    totalFileSize: stats.totalFileSize,
    totalFileHandler: stats.totalFileHandler,
    totalFileNew: stats.totalFileNew,
    totalFileNewSize: stats.totalFileNewSize,
    totalDir: stats.totalDir,
    totalDirNew: stats.totalDirNew,
  };
}

function startChild() {
  const config: DfcConfig = createDefaultConfig();
  if (workerData.config) Object.assign(config, workerData.config);

  const port = parentPort;
  if (!port) throw new Error('parentPort is unavailable');

  const idx = workerData.idx as number;

  /** 执行一个任务并上报进度 */
  function executeTask(msg: TaskMessage) {
    fileCopy(config, msg.filePathList, {
      onProgress: (stats) => {
        port!.postMessage({
          type: 'progress',
          idx,
          taskId: msg.taskId,
          batchId: msg.batchId,
          ...pickStats(stats),
        });
      },
      onEnd: (stats) => {
        port!.postMessage({
          type: 'done',
          idx,
          taskId: msg.taskId,
          batchId: msg.batchId,
          ...pickStats(stats),
        });
      },
    });
  }

  // 池模式：常驻并循环接收任务（同一时刻只会收到一个任务，主线程仅在空闲时才派发）
  if (workerData.poolMode) {
    port.on('message', (msg: TaskMessage) => {
      if (msg?.type === 'task' && Array.isArray(msg.filePathList)) executeTask(msg);
    });
    return;
  }

  // 兼容模式：直接从 workerData 获取文件列表
  if (workerData.filePathList) {
    executeTask({
      type: 'task',
      taskId: 0,
      batchId: 0,
      filePathList: workerData.filePathList,
    });
  }
}

function start() {
  if (isMainThread) {
    console.log('子线程处理文件仅支持使用 new workerThreads.Worker 方式调用');
  } else {
    startChild();
  }
}

start();
