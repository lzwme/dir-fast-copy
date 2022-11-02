import * as path from 'path';
import * as fs from 'fs';
import { color, log } from 'console-log-colors';
import  globToRegExp from 'glob-to-regexp';
import CONFIG from './config';
import { help, logPrint } from './utils';

/** 处理入参信息 */
export function parseConfig(cfg: typeof CONFIG) {
  cfg.src = String(cfg.src || '').trim();
  cfg.dest = String(cfg.dest || '').trim();

  if (!cfg.src) {
    log.red('未指定要复制的源目录！');
    help();
    return;
  }

  if (!cfg.dest) {
    log.red('未指定要复制至的目的目录！');
    help();
    return;
  }

  cfg.src = path.resolve(cfg.src);
  cfg.dest = path.resolve(cfg.dest);

  if (!fs.existsSync(cfg.src)) return console.log(' 源目录不存在，请检查确认：', color.red(cfg.src));

  if (cfg.dest === cfg.src || cfg.dest.includes(cfg.src + path.sep)) {
    log.red('\n源路径不能与目的路径相同或是目的路径的子目录！');
    return;
  }

  cfg.minDateTime = cfg.minDateTime ? new Date(cfg.minDateTime).getTime() || 0 : CONFIG.minDateTime;
  cfg.mutiThreadMinFiles = Number(cfg.mutiThreadMinFiles) >= 1000 ? Number(cfg.mutiThreadMinFiles) : CONFIG.mutiThreadMinFiles;
  cfg.progressInterval = Number(cfg.progressInterval) > 99 ? Number(cfg.progressInterval) : CONFIG.progressInterval;

  Object.assign(CONFIG, cfg);
  logPrint('源路径  : ', color.cyan(CONFIG.src), '\n目的路径: ', color.cyan(CONFIG.dest), '\n');

  // 文件排除规则
  if (!CONFIG.exclude) CONFIG.exclude = [];
  CONFIG.exclude.forEach((val, i) => {
    if (val instanceof RegExp) return;
    CONFIG.exclude[i] = globToRegExp(val, { extended: true, flags: 'gi' });
  });

  // console.debug('CONFIG.exclude', CONFIG.exclude);

  return CONFIG;
}
