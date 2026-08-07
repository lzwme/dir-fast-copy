import { color, log } from 'console-log-colors';
import * as fs from 'fs';
import globToRegExp from 'glob-to-regexp';
import * as path from 'path';
import { createDefaultConfig } from './config';
import type { DfcConfig } from './type';
import { logPrint } from './utils';

/** 入参配置，src/dest 允许为空或 null */
export type DfcConfigInput = Omit<Partial<DfcConfig>, 'src' | 'dest'> & { src?: string | null; dest?: string | null };

/**
 * 解析并校验入参配置，返回完整的 DfcConfig 对象
 * 不再修改全局 CONFIG，而是返回一个新的配置对象
 */
export function parseConfig(cfg: DfcConfigInput): DfcConfig | undefined {
  const src = String(cfg.src || '').trim();
  const dest = String(cfg.dest || '').trim();

  if (!src) {
    log.red('未指定要复制的源目录！');
    return;
  }

  if (!dest) {
    log.red('未指定要复制至的目的目录！');
    return;
  }

  const resolvedSrc = path.resolve(src);
  const resolvedDest = path.resolve(dest);

  if (!fs.existsSync(resolvedSrc)) {
    console.log(' 源目录不存在，请检查确认：', color.red(resolvedSrc));
    return;
  }

  if (resolvedDest === resolvedSrc || resolvedDest.includes(resolvedSrc + path.sep)) {
    log.red('\n源路径不能与目的路径相同或是目的路径的子目录！');
    return;
  }

  // 基于默认配置构建新配置
  const defaults = createDefaultConfig();
  const config: DfcConfig = {
    ...defaults,
    ...cfg,
    src: resolvedSrc,
    dest: resolvedDest,
    minDateTime: cfg.minDateTime ? new Date(cfg.minDateTime).getTime() || 0 : defaults.minDateTime,
    mutiThreadMinFiles: Number(cfg.mutiThreadMinFiles) >= 1000 ? Number(cfg.mutiThreadMinFiles) : defaults.mutiThreadMinFiles,
    progressInterval: Number(cfg.progressInterval) > 99 ? Number(cfg.progressInterval) : defaults.progressInterval,
  };

  logPrint(config, '源路径  : ', color.cyan(config.src), '\n目的路径: ', color.cyan(config.dest), '\n');

  // 文件排除规则：将 glob 字符串转为 RegExp
  const excludeList = (config.exclude || []) as (string | RegExp)[];
  config.exclude = excludeList.map((val) => {
    if (val instanceof RegExp) return val;
    return globToRegExp(String(val), { extended: true, flags: 'gi' });
  });

  // 文件包含规则：将 glob 字符串转为 RegExp
  const includeList = (config.include || []) as (string | RegExp)[];
  config.include = includeList.map((val) => {
    if (val instanceof RegExp) return val;
    return globToRegExp(String(val), { extended: true, flags: 'gi' });
  });

  if (config.debug) console.debug('[config][parsed]', config);

  return config;
}
