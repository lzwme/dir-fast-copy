import { DfcConfig } from '../types';

const config: DfcConfig = {
  slient: false,
  iscmd: false,
  src: '',
  desc: '',
  mutiThread: true,
  mutiThreadMinCount: 3000,
  exclude: [], // [/\.pyc$/],
  minDateTime: 0, // new Date('1970-01-01T00:00:00').getTime(),
  skipSameFile: true,
  progressInterval: 2000,
  /** 结束时回调方法 */
  onEnd: null,
  onProgress: null,
};

export default config;
