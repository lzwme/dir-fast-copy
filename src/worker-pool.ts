/*
 * Worker 池化管理
 * - Worker 常驻复用：一次性创建，跨批次持续分发任务，避免每个批次重复创建/销毁线程
 * - 任务队列 + 空闲即取：把文件列表切成若干小块排队，由空闲 Worker 领取，负载自动均衡，
 *   避免“固定分片”模式下某个 Worker 分到大文件而拖慢整体收尾
 * - 按任务维度统计：同一 Worker 顺序处理多个任务，统计不会相互覆盖
 */

import * as path from 'path';
import * as workerThreads from 'worker_threads';
import { serializeConfig } from './config';
import type { DfcConfig, DfcFileItem, DfcStats } from './type';
import { createEmptyStats } from './utils';

/** Worker 池中的单个 Worker 实例 */
interface PoolWorker {
  worker: workerThreads.Worker;
  idx: number;
  /** 是否正在执行任务 */
  busy: boolean;
  /** 正在执行的任务 id，0 表示空闲 */
  taskId: number;
  /** Worker 已不可用(异常退出)，不再分配任务 */
  dead: boolean;
}

/** 子线程上报的消息 */
interface ThreadStatsMessage extends DfcStats {
  type: 'progress' | 'done';
  /** 子线程编号 */
  idx: number;
  /** 任务 id */
  taskId: number;
  /** 批次 id */
  batchId: number;
}

/** 一个复制任务（文件列表的一个分片） */
interface PoolTask {
  taskId: number;
  batchId: number;
  filePathList: DfcFileItem[];
}

/** 一次 submitTasks 提交对应一个批次 */
interface PoolBatch {
  id: number;
  /** 批次文件总数 */
  totalFile: number;
  /** 未完成的任务数 */
  remaining: number;
  /** 本批次的任务 id 列表 */
  taskIds: number[];
  /** 本批次累计统计 */
  stats: DfcStats;
  onProgress?: DfcConfig['onProgress'];
  resolve: (stats: DfcStats) => void;
}

/** submitTasks 的可选参数 */
export interface SubmitTasksOptions {
  /** 本批次的进度回调（受 progressInterval 限流） */
  onProgress?: DfcConfig['onProgress'];
}

/** 每个 Worker 同时排队的目标任务数，用于确定分片粒度（分片越小负载越均衡，但消息开销越大） */
const TASKS_PER_WORKER = 8;

/**
 * Worker 池
 * 管理一组常驻 Worker，按队列分发任务并汇总统计
 */
export class WorkerPool {
  private pool: PoolWorker[] = [];
  private taskQueue: PoolTask[] = [];
  /** 未完成的任务，key 为 taskId */
  private activeTasks = new Map<number, PoolTask>();
  /** 未完成任务的统计信息，key 为 taskId */
  private taskStats = new Map<number, ThreadStatsMessage>();
  /** 进行中的批次，key 为 batchId */
  private activeBatches = new Map<number, PoolBatch>();
  /** 已结束批次的累计统计 */
  private totalStats: DfcStats = createEmptyStats();
  private totalThreads: number;
  private config: DfcConfig;
  private preNotifyProgressTime = 0;
  private taskSeq = 0;
  private batchSeq = 0;
  private initialized = false;
  private disposed = false;

  constructor(config: DfcConfig) {
    this.config = config;
    this.totalThreads = Math.max(config.threads || 1, 1);
  }

  /** 初始化 Worker 池（幂等，重复调用不会重复创建线程） */
  init(): number {
    if (this.initialized) return this.totalThreads;
    this.initialized = true;

    const workerFile = path.resolve(__dirname, './worker.js');
    const childCfg = serializeConfig(this.config);

    for (let idx = 0; idx < this.totalThreads; idx++) {
      const worker = new workerThreads.Worker(workerFile, {
        workerData: {
          idx,
          config: childCfg,
          poolMode: true,
        },
      });

      worker.on('message', (data: ThreadStatsMessage) => this.handleMessage(data));
      worker.on('error', (err: Error) => {
        console.error(`子线程 ${idx} 异常:`, err);
        this.abortWorker(idx);
      });
      // 池模式下线程应当常驻，任何非 dispose 引起的退出都要释放其任务，否则批次会永远等待
      worker.on('exit', (code: number) => {
        if (this.disposed) return;
        console.error(`子线程 ${idx} 已退出，退出码：${code}`);
        this.abortWorker(idx);
      });

      this.pool.push({ worker, idx, busy: false, taskId: 0, dead: false });
    }

    return this.totalThreads;
  }

  /** 可用的 Worker 数量 */
  getTotalThreads(): number {
    return this.totalThreads;
  }

  /**
   * 提交一批文件进行复制
   * @returns 该批次复制完成后的统计信息
   */
  submitTasks(filePathList: DfcFileItem[], opts: SubmitTasksOptions = {}): Promise<DfcStats> {
    this.init();

    const batch: PoolBatch = {
      id: ++this.batchSeq,
      totalFile: filePathList.length,
      remaining: 0,
      taskIds: [],
      stats: createEmptyStats(),
      onProgress: opts.onProgress,
      resolve: () => undefined,
    };
    batch.stats.totalFile = filePathList.length;

    // 空批次直接返回，避免调用方等待一个永远不会完成的 Promise
    if (!filePathList.length) return Promise.resolve(batch.stats);

    const done = new Promise<DfcStats>((resolve) => {
      batch.resolve = resolve;
    });
    this.activeBatches.set(batch.id, batch);

    // 切分为小块排队，由空闲 Worker 依次领取
    const chunkSize = Math.max(1, Math.ceil(filePathList.length / (this.totalThreads * TASKS_PER_WORKER)));
    for (let i = 0; i < filePathList.length; i += chunkSize) {
      const task: PoolTask = {
        taskId: ++this.taskSeq,
        batchId: batch.id,
        filePathList: filePathList.slice(i, i + chunkSize),
      };
      batch.taskIds.push(task.taskId);
      batch.remaining++;
      this.activeTasks.set(task.taskId, task);
      this.taskQueue.push(task);
    }

    this.dispatchTasks();
    return done;
  }

  /** 把队列中的任务分发给空闲 Worker */
  private dispatchTasks(): void {
    if (this.disposed) return;

    // 没有可用 Worker 时(如线程创建即失败)，直接结束排队任务，避免调用方永远等待
    if (!this.pool.some((w) => !w.dead)) {
      if (!this.taskQueue.length) return;

      console.error('没有可用的子线程，剩余任务未能执行');
      for (const task of this.taskQueue.splice(0)) {
        if (!this.taskStats.has(task.taskId)) {
          this.taskStats.set(task.taskId, {
            ...createEmptyStats(),
            type: 'done',
            idx: -1,
            taskId: task.taskId,
            batchId: task.batchId,
          });
        }
        this.completeTask(task.taskId);
      }
      return;
    }

    if (!this.taskQueue.length) return;

    for (const pw of this.pool) {
      if (pw.dead || pw.busy) continue;

      const task = this.taskQueue.shift();
      if (!task) return;

      pw.busy = true;
      pw.taskId = task.taskId;
      pw.worker.postMessage({
        type: 'task',
        taskId: task.taskId,
        batchId: task.batchId,
        filePathList: task.filePathList,
      });
    }
  }

  /** 处理子线程消息 */
  private handleMessage(data: ThreadStatsMessage): void {
    if (this.disposed) return;

    const batch = this.activeBatches.get(data.batchId);
    if (!batch) return;

    this.taskStats.set(data.taskId, data);
    this.recomputeBatchStats(batch);

    if (data.type === 'progress') {
      // 进度限流，避免消息风暴
      const now = Date.now();
      if (now - this.preNotifyProgressTime >= (this.config.progressInterval || 0)) {
        this.preNotifyProgressTime = now;
        batch.onProgress?.(batch.stats);
      }
      return;
    }

    // 任务完成：释放 Worker 并分发后续任务
    const pw = this.pool.find((w) => w.idx === data.idx);
    if (pw) {
      pw.busy = false;
      pw.taskId = 0;
    }

    this.completeTask(data.taskId);
  }

  /** 按任务维度汇总批次统计（同一 Worker 处理多个任务时不会相互覆盖） */
  private recomputeBatchStats(batch: PoolBatch): void {
    const s = batch.stats;
    s.totalFileHandler = 0;
    s.totalFileNew = 0;
    s.totalFileNewSize = 0;
    s.totalFileSize = 0;
    s.totalDirNew = 0;

    for (const taskId of batch.taskIds) {
      const item = this.taskStats.get(taskId);
      if (!item) continue;
      s.totalFileHandler += item.totalFileHandler;
      s.totalFileNew += item.totalFileNew;
      s.totalFileNewSize += item.totalFileNewSize;
      s.totalFileSize += item.totalFileSize;
      s.totalDirNew += item.totalDirNew;
    }
  }

  /** 标记任务完成，必要时结束批次 */
  private completeTask(taskId: number): void {
    const task = this.activeTasks.get(taskId);
    if (!task) return;

    this.activeTasks.delete(taskId);

    const batch = this.activeBatches.get(task.batchId);
    if (batch) {
      batch.remaining--;
      if (batch.remaining <= 0) this.finishBatch(batch);
    }

    this.dispatchTasks();
  }

  /** 结束批次并回调 */
  private finishBatch(batch: PoolBatch): void {
    this.activeBatches.delete(batch.id);
    for (const taskId of batch.taskIds) {
      this.activeTasks.delete(taskId);
      this.taskStats.delete(taskId);
    }

    // 累加到池级别的总统计
    this.totalStats = mergeStats(this.totalStats, batch.stats);
    batch.resolve(batch.stats);

    // 仍有排队任务时继续分发（例如其他批次的剩余任务）
    this.dispatchTasks();
  }

  /** Worker 不可用时，使其正在执行的任务不至于挂住整个批次 */
  private abortWorker(idx: number): void {
    if (this.disposed) return;

    const pw = this.pool.find((w) => w.idx === idx);
    if (!pw || pw.dead) return;

    pw.dead = true;
    pw.busy = false;

    const taskId = pw.taskId;
    pw.taskId = 0;
    if (!taskId) return;

    const task = this.activeTasks.get(taskId);
    if (!task) return;

    if (this.pool.some((w) => !w.dead)) {
      // 还有其他可用 Worker，重新排队让存活线程接替（已复制的文件会被 skipSameFile 跳过）
      this.taskQueue.unshift(task);
      this.dispatchTasks();
    } else {
      console.error('所有子线程均不可用，任务中止，部分文件可能未被复制');
      const stats = this.taskStats.get(taskId);
      if (!stats) {
        this.taskStats.set(taskId, {
          ...createEmptyStats(),
          type: 'done',
          idx,
          taskId,
          batchId: task.batchId,
        });
      }
      this.completeTask(taskId);
    }
  }

  /** 池级别的累计统计（含已结束批次） */
  getStats(): DfcStats {
    return this.totalStats;
  }

  /** 销毁 Worker 池 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const pw of this.pool) {
      pw.worker.removeAllListeners('message');
      pw.worker.removeAllListeners('error');
      pw.worker.removeAllListeners('exit');
      void pw.worker.terminate();
    }

    this.pool = [];
    this.taskQueue = [];
    this.activeTasks.clear();
    this.taskStats.clear();
    this.activeBatches.clear();
  }
}

/** 合并统计数据（返回新对象） */
function mergeStats(target: DfcStats, source: DfcStats): DfcStats {
  return {
    allFilePaths: target.allFilePaths,
    allDirPaths: target.allDirPaths,
    totalFile: target.totalFile + source.totalFile,
    totalFileSize: target.totalFileSize + source.totalFileSize,
    totalFileHandler: target.totalFileHandler + source.totalFileHandler,
    totalFileNew: target.totalFileNew + source.totalFileNew,
    totalFileNewSize: target.totalFileNewSize + source.totalFileNewSize,
    totalDir: target.totalDir + source.totalDir,
    totalDirNew: target.totalDirNew + source.totalDirNew,
  };
}
