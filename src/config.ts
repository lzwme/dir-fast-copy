import { cpus } from 'os';
import { type DfcConfig } from './type';

export const CONFIG: DfcConfig = {
  slient: false,
  iscmd: false,
  src: '',
  dest: '',
  threads: Math.max(cpus().length - 1, 1),
  mutiThreadMinFiles: 3000,
  exclude: [], // [/\.pyc$/],
  minDateTime: 0, // new Date('1970-01-01T00:00:00').getTime(),
  skipSameFile: true,
  progressInterval: 2000,
  /** 结束时回调方法 */
  onEnd: null,
  onProgress: null,
};

export default CONFIG;
