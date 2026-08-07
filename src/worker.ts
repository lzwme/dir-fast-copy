/*
 * @Author: lzw
 * @Date: 2020-09-18 09:52:53
 * @LastEditors: lzw
 * @LastEditTime: 2024-08-06
 * @Description: 子线程 worker（支持池模式和传统模式）
 */
import { isMainThread, parentPort, workerData } from 'worker_threads';
import { createDefaultConfig } from './config';
import type { DfcConfig } from './type';
import { fileCopy } from './utils';

function startChild() {
  const config: DfcConfig = createDefaultConfig();
  if (workerData.config) Object.assign(config, workerData.config);

  const port = parentPort;
  if (!port) throw new Error('parentPort is unavailable');

  const idx = workerData.idx as number;

  /** 执行一批文件的复制并上报进度 */
  function executeFileCopy(filePathList: unknown[]) {
    fileCopy(config, filePathList as Parameters<typeof fileCopy>[1], {
      onProgress: (stats) => {
        port!.postMessage({
          type: 'progress',
          idx,
          ...stats,
        });
      },
      onEnd: (stats) => {
        port!.postMessage({
          type: 'done',
          idx,
          ...stats,
        });
      },
    });
  }

  // 池模式：等待主线程发送任务消息
  if (workerData.poolMode) {
    port.on('message', (msg: { type: string; filePathList: unknown[] }) => {
      if (msg.type === 'task') {
        executeFileCopy(msg.filePathList);
      }
    });
    return;
  }

  // 传统模式：直接从 workerData 获取文件列表
  if (workerData.filePathList) {
    executeFileCopy(workerData.filePathList);
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
