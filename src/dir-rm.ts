import * as fs from 'fs';
import * as path from 'path';
import { color } from 'console-log-colors';
import CONFIG from './config';
import { showCostTime, logPrint, readSyncByRl } from './utils';

export async function dirRm(option) {
  // console.log(option);
  if (!option.src) return console.log('请指定要删除的文件或目录路径');
  option.src = path.resolve(option.src);
  if (!fs.existsSync(option.src)) return console.log('要删除的文件或目录路径不存在！', color.red(option.src));
  const srcTip = fs.statSync(option.src).isFile() ? '文件' : '目录';

  if (option.slient) CONFIG.slient = true;
  if (!option.force) {
    const force = await readSyncByRl(`是否删除该${srcTip}(y/)？[${color.red(option.src)}] `);
    if ('y' !== String(force).trim().toLowerCase()) return;
  }
  const startTime = Date.now();

  fs.rmdirSync(option.src, { recursive: true });
  logPrint(`$[${showCostTime(startTime)}] {srcTip}已删除：`, color.green(option.src));
  return true;
}
