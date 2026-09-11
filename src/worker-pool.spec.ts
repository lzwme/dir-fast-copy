import { beforeEach, describe, expect, it, vi } from 'vitest';

/** 模拟 Worker：不真正起线程，收到任务后异步回传 done 消息 */
vi.mock('worker_threads', () => {
  interface FakeMessage {
    type: string;
    taskId: number;
    batchId: number;
    filePathList: unknown[];
  }

  class FakeWorker {
    static instances: FakeWorker[] = [];
    /** 下一次收到任务时模拟异常退出 */
    static failWorkerIdx = -1;

    handlers = new Map<string, ((...args: never[]) => void)[]>();
    posted: FakeMessage[] = [];
    idx: number;
    terminated = false;

    constructor(_file: string, opts: { workerData: { idx: number } }) {
      this.idx = opts.workerData.idx;
      FakeWorker.instances.push(this);
    }

    on(event: string, cb: (...args: never[]) => void) {
      const list = this.handlers.get(event) ?? [];
      list.push(cb);
      this.handlers.set(event, list);
      return this;
    }

    removeAllListeners() {
      this.handlers.clear();
      return this;
    }

    emit(event: string, ...args: unknown[]) {
      for (const cb of this.handlers.get(event) ?? []) (cb as (...a: unknown[]) => void)(...args);
    }

    postMessage(msg: FakeMessage) {
      this.posted.push(msg);
      setTimeout(() => {
        if (FakeWorker.failWorkerIdx === this.idx) {
          FakeWorker.failWorkerIdx = -1;
          this.emit('error', new Error('mock worker failure'));
          return;
        }
        const count = msg.filePathList.length;
        this.emit('message', {
          type: 'done',
          idx: this.idx,
          taskId: msg.taskId,
          batchId: msg.batchId,
          allFilePaths: [],
          allDirPaths: [],
          totalFile: count,
          totalFileSize: count,
          totalFileHandler: count,
          totalFileNew: count,
          totalFileNewSize: count,
          totalDir: 0,
          totalDirNew: 0,
        });
      }, 0);
    }

    terminate() {
      this.terminated = true;
      return Promise.resolve(0);
    }
  }

  return {
    Worker: FakeWorker,
    __FakeWorker: FakeWorker,
    isMainThread: true,
    parentPort: null,
    workerData: {},
  };
});

import * as workerThreads from 'worker_threads';
import { createDefaultConfig } from './config';
import type { DfcConfig, DfcFileItem } from './type';
import { WorkerPool } from './worker-pool';

interface FakeWorkerClass {
  instances: {
    idx: number;
    posted: { taskId: number; batchId: number; filePathList: unknown[] }[];
    terminated: boolean;
  }[];
  failWorkerIdx: number;
}

const FakeWorker = (workerThreads as unknown as { __FakeWorker: FakeWorkerClass }).__FakeWorker;

function makeConfig(threads = 4): DfcConfig {
  return { ...createDefaultConfig(), src: '/tmp/src', dest: '/tmp/dest', threads, progressInterval: 100 };
}

function makeList(count: number): DfcFileItem[] {
  return Array.from({ length: count }, (_, i) => ({
    src: `/src/f${i}.txt`,
    dest: `/dest/f${i}.txt`,
    srcStat: { isFile: true, isDirectory: false, atime: new Date(0), mtime: new Date(0), size: 1 },
  }));
}

beforeEach(() => {
  FakeWorker.instances.length = 0;
  FakeWorker.failWorkerIdx = -1;
});

describe('WorkerPool', () => {
  it('空列表应立即完成，不创建线程也不挂起', async () => {
    const pool = new WorkerPool(makeConfig());
    const stats = await pool.submitTasks([]);

    expect(stats.totalFile).toBe(0);
    expect(stats.totalFileHandler).toBe(0);
    pool.dispose();
  });

  it('应把文件切分为多个任务并汇总统计', async () => {
    const pool = new WorkerPool(makeConfig(4));
    const stats = await pool.submitTasks(makeList(1000));

    expect(stats.totalFile).toBe(1000);
    expect(stats.totalFileHandler).toBe(1000);
    expect(stats.totalFileNew).toBe(1000);

    // 分片粒度：每个线程排队 TASKS_PER_WORKER(8) 个任务，切分后任务数应大于线程数
    const postedTasks = FakeWorker.instances.flatMap((w) => w.posted);
    expect(postedTasks.length).toBeGreaterThan(4);
    expect(postedTasks.reduce((sum, t) => sum + t.filePathList.length, 0)).toBe(1000);

    pool.dispose();
  });

  it('同一线程池应被多个批次复用（不重复创建线程）', async () => {
    const pool = new WorkerPool(makeConfig(4));
    pool.init();
    expect(FakeWorker.instances.length).toBe(4);

    const first = await pool.submitTasks(makeList(500));
    const second = await pool.submitTasks(makeList(300));

    expect(first.totalFile).toBe(500);
    expect(second.totalFile).toBe(300);
    // 第二批未新增线程
    expect(FakeWorker.instances.length).toBe(4);
    // 每个线程都参与了工作
    expect(FakeWorker.instances.every((w) => w.posted.length > 0)).toBe(true);

    pool.dispose();
  });

  it('某个线程异常退出时，其任务应被其他线程接替且批次正常结束', async () => {
    const pool = new WorkerPool(makeConfig(2));
    pool.init();
    FakeWorker.failWorkerIdx = 0;

    const stats = await pool.submitTasks(makeList(200));

    expect(stats.totalFile).toBe(200);
    expect(stats.totalFileHandler).toBe(200);
    pool.dispose();
  });

  it('dispose 后应终止所有线程', () => {
    const pool = new WorkerPool(makeConfig(3));
    pool.init();
    pool.dispose();

    expect(FakeWorker.instances.every((w) => w.terminated)).toBe(true);
  });
});
