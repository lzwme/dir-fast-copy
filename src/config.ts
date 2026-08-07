import { cpus } from 'os';
import type { DfcConfig } from './type';

/** 创建默认配置（每次调用返回新对象，避免全局可变状态） */
export function createDefaultConfig(): DfcConfig {
  return {
    slient: false,
    iscmd: false,
    src: '',
    dest: '',
    threads: Math.max(cpus().length - 1, 1),
    mutiThreadMinFiles: 3000,
    exclude: [],
    include: [],
    minDateTime: 0,
    skipSameFile: true,
    cpDuringStats: false,
    progressInterval: 2000,
    deleteSrc: false,
    onEnd: null,
    onProgress: null,
  };
}

/**
 * 序列化配置给子线程（去除函数类型，因为 postMessage 不能传递函数）
 */
export function serializeConfig(config: DfcConfig): Record<string, unknown> {
  const childCfg: Record<string, unknown> = { ...config };
  for (const key of Object.keys(childCfg)) {
    if (typeof childCfg[key] === 'function') delete childCfg[key];
  }
  return childCfg;
}
