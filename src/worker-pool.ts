/*
 * Worker 池化管理
 * 预创建 Worker 并复用，避免频繁创建/销毁 Worker 的开销
 */

import * as path from 'path';
import * as workerThreads from 'worker_threads';
import { serializeConfig } from './config';
import type { DfcConfig, DfcFileItem, DfcStats } from './type';

/** Worker 池中的单个 Worker 实例 */
interface PoolWorker {
  worker: workerThreads.Worker;
  busy: boolean;
  idx: number;
}

/** 子线程上报的消息 */
interface ThreadStatsMessage extends DfcStats {
  type: 'progress' | 'done';
  idx: number;
}

/** Worker 任务 */
interface WorkerTask {
  idx: number;
  filePathList: DfcFileItem[];
  onProgress: (stats: DfcStats) => void;
  onEnd: (stats: DfcStats) => void;
}

/**
 * Worker 池
 * 管理一组预创建的 Worker，分配任务并汇总统计信息
 */
export class WorkerPool {
  private pool: PoolWorker[] = [];
  private taskQueue: WorkerTask[] = [];
  private threadsStats: Record<number, ThreadStatsMessage> = {};
  private threadDoneCount = 0;
  private totalThreads: number;
  private config: DfcConfig;
  private startTime: number;
  private aggregateStats: DfcStats;
  private preNotifyProgressTime = 0;
  private onAllDone?: (stats: DfcStats) => void;
  private onProgress?: DfcConfig['onProgress'];
  private disposed = false;

  constructor(
    config: DfcConfig,
    opts: {
      startTime?: number;
      onProgress?: DfcConfig['onProgress'];
      onAllDone?: (stats: DfcStats) => void;
    } = {},
  ) {
    this.config = config;
    this.totalThreads = config.threads || 1;
    this.startTime = opts.startTime || Date.now();
    this.onProgress = opts.onProgress;
    this.onAllDone = opts.onAllDone;
    this.aggregateStats = this.createEmptyStats();
  }

  private createEmptyStats(): DfcStats {
    return {
      allFilePaths: [],
      allDirPaths: [],
      totalFile: 0,
      totalFileSize: 0,
      totalFileHandler: 0,
      totalFileNew: 0,
      totalFileNewSize: 0,
      totalDir: 0,
      totalDirNew: 0,
      startTime: this.startTime,
    };
  }

  /** 初始化 Worker 池（预创建所有 Worker） */
  init(): number {
    const workerFile = path.resolve(__dirname, './worker.js');
    const childCfg = serializeConfig(this.config);

    for (let idx = 0; idx < this.totalThreads; idx++) {
      const worker = new workerThreads.Worker(workerFile, {
        workerData: {
          idx,
          config: childCfg,
          poolMode: true, // 池模式标识
        },
      });

      worker.on('message', (data: ThreadStatsMessage) => this.handleMessage(idx, data));
      worker.on('error', (err) => {
        console.error(`Worker ${idx} 错误:`, err);
      });

      this.pool.push({ worker, busy: false, idx });
    }

    return this.totalThreads;
  }

  /** 提交一批文件给 Worker 池处理 */
  submitTasks(filePathList: DfcFileItem[]): void {
    const sepCount = Math.ceil(filePathList.length / this.totalThreads);

    for (let idx = 0; idx < this.totalThreads; idx++) {
      const slice = filePathList.slice(idx * sepCount, (idx + 1) * sepCount);
      if (slice.length === 0) {
        // 没有文件需要处理，直接标记完成
        this.threadDoneCount++;
        continue;
      }

      this.taskQueue.push({
        idx,
        filePathList: slice,
        onProgress: (_stats: DfcStats) => {
          // progress 在 handleMessage 中统一处理
        },
        onEnd: (_stats: DfcStats) => {
          // done 在 handleMessage 中统一处理
        },
      });
    }

    // 立即分配所有任务
    this.dispatchTasks();
  }

  /** 分发队列中的任务给空闲 Worker */
  private dispatchTasks(): void {
    for (const pw of this.pool) {
      if (pw.busy) continue;
      const task = this.taskQueue.find((t) => t.idx === pw.idx);
      if (!task) continue;

      pw.busy = true;
      this.taskQueue = this.taskQueue.filter((t) => t !== task);

      pw.worker.postMessage({
        type: 'task',
        idx: task.idx,
        filePathList: task.filePathList,
      });
    }
  }

  /** 处理 Worker 消息 */
  private handleMessage(idx: number, data: ThreadStatsMessage): void {
    if (this.disposed) return;

    this.threadsStats[data.idx] = data;

    if (data.type === 'progress') {
      if (Date.now() - this.preNotifyProgressTime < (this.config.progressInterval || 0)) return;
      this.preNotifyProgressTime = Date.now();
    }

    // 汇总统计
    this.aggregateStats.totalFileHandler = 0;
    this.aggregateStats.totalFileNew = 0;
    this.aggregateStats.totalFileNewSize = 0;
    this.aggregateStats.totalFileSize = 0;
    this.aggregateStats.totalDirNew = 0;

    for (const key of Object.keys(this.threadsStats)) {
      const item = this.threadsStats[Number(key)];
      this.aggregateStats.totalFileHandler += item.totalFileHandler;
      this.aggregateStats.totalFileNew += item.totalFileNew;
      this.aggregateStats.totalFileNewSize += item.totalFileNewSize;
      this.aggregateStats.totalFileSize += item.totalFileSize;
      this.aggregateStats.totalDirNew += item.totalDirNew;
    }

    if (data.type === 'progress') {
      this.onProgress?.(this.aggregateStats);
    }

    if (data.type === 'done') {
      this.threadDoneCount++;

      // 标记 Worker 为空闲
      const pw = this.pool.find((w) => w.idx === idx);
      if (pw) pw.busy = false;

      // 尝试分发剩余任务
      this.dispatchTasks();

      // 检查是否全部完成
      if (this.threadDoneCount >= this.totalThreads) {
        this.onAllDone?.(this.aggregateStats);
      }
    }
  }

  /** 获取当前汇总统计 */
  getStats(): DfcStats {
    return this.aggregateStats;
  }

  /** 销毁 Worker 池 */
  dispose(): void {
    this.disposed = true;
    for (const pw of this.pool) {
      pw.worker.removeAllListeners('message');
      pw.worker.removeAllListeners('error');
      pw.worker.terminate();
    }
    this.pool = [];
    this.taskQueue = [];
  }
}
