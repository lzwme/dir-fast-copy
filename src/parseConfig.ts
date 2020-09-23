import * as path from 'path';
import * as fs from 'fs';
const globToRegExp = require('glob-to-regexp');
const { log, color } = require('console-log-colors');
import CONFIG from './config';
import { help, logPrint } from './utils';

/** 处理入参信息 */
export function parseConfig(cfg: typeof CONFIG) {
  cfg.src = String(cfg.src || '').trim();
  cfg.desc = String(cfg.desc || '').trim();

  if (!cfg.src) {
    log.red('未指定要复制的源目录！');
    help();
    return;
  }

  if (!cfg.desc) {
    log.red('未指定要复制至的目的目录！');
    help();
    return;
  }

  cfg.src = path.resolve(cfg.src);
  cfg.desc = path.resolve(cfg.desc);

  if (!fs.existsSync(cfg.src)) return console.log(' 源目录不存在，请检查确认：', color.red(cfg.src));

  if (cfg.desc.includes(cfg.src + path.sep)) {
    log.red('\n源路径不能与目的路径相同或是目的路径的子目录！');
    return;
  }

  Object.assign(CONFIG, cfg);
  logPrint('源路径  : ', color.green(CONFIG.src), '\n目的路径: ', color.green(CONFIG.desc), '\n');

  // 文件排除规则
  if (!CONFIG.exclude) CONFIG.exclude = [];
  CONFIG.exclude.forEach((val, i) => {
    if (val instanceof RegExp) return;
    CONFIG.exclude[i] = globToRegExp(val, { extended: true });
  });

  CONFIG.mutiThreadMinCount = Math.max(Number(CONFIG.mutiThreadMinCount) || 0, 1000);
  CONFIG.minDateTime = CONFIG.minDateTime ? new Date(CONFIG.minDateTime).getTime() || 0 : 0;

  // console.log(CONFIG);
  return CONFIG;
}
