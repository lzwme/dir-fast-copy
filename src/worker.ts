/*
 * @Author: lzw
 * @Date: 2020-09-18 09:52:53
 * @LastEditors: lzw
 * @LastEditTime: 2020-09-22 21:23:51
 * @Description: 子线程 worker
 */
import { parentPort, workerData, isMainThread } from 'worker_threads';
import { color } from 'console-log-colors';
import { fileCopy, logPrint } from './utils';
import CONFIG from './config';

/** 启动子线程 */
function startChild() {
  if (workerData.config) Object.assign(CONFIG, workerData.config);

  logPrint(`子线程 ${workerData.idx} 已启动，收到待处理文件数为：`, color.yellow(workerData.filePathList.length));
  // startTime = workerData.startTime;

  fileCopy(workerData.filePathList, {
    onProgress: (stats) => {
      parentPort.postMessage({
        type: 'progress',
        idx: workerData.idx,
        ...stats,
      });
    },
    onEnd: (stats) => {
      parentPort.postMessage({
        type: 'done',
        idx: workerData.idx,
        ...stats,
      });
    },
  });
}

function start() {
  if (isMainThread) {
    console.log('子线程处理文件仅支持使用 new workerThreads.Worker 方式调用');
  } else {
    startChild();
  }
}

start();
