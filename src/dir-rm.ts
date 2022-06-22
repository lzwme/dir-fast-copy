import * as fs from 'fs';
import * as path from 'path';
import { color } from 'console-log-colors';
import CONFIG from './config';
import { showCostTime, logPrint, readSyncByRl } from './utils';
import { DfcDirRmOptions } from '../types';

async function doDirRm(src: string, option: DfcDirRmOptions) {
  if (!src) return console.log('请指定要删除的文件或目录路径');
  src = path.resolve(src);
  if (!fs.existsSync(src)) return console.log('要删除的文件或目录路径不存在！', color.red(src));
  const srcTip = fs.statSync(src).isFile() ? '文件' : '目录';

  if (option.slient) CONFIG.slient = true;
  if (!option.force) {
    const force = await readSyncByRl(`是否删除该${srcTip}(y/)？[${color.red(src)}] `);
    if ('y' !== String(force).trim().toLowerCase()) return;
  }
  const startTime = Date.now();

  if (typeof fs.rmSync === 'function') fs.rmSync(src, { recursive: true });
  else fs.rmdirSync(src, { recursive: true });

  logPrint(`$[${showCostTime(startTime)}] ${srcTip}已删除：`, color.green(src));
  return true;
}

export async function dirRm(option: DfcDirRmOptions) {
  if (!Array.isArray(option.src)) return console.log('请指定要删除的文件或目录路径');
  if (option.src.length === 1) return doDirRm(option.src[0], option);

  for (const src of option.src) {
    await doDirRm(src, option);
  }

  return true;
}
