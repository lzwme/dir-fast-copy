import { DfcConfig } from '../types';

const config: DfcConfig = {
  /** 是否静默模式 */
  slient: false,
  /** 是否为 cmd 命令方式调用(dfc --src --desc) */
  iscmd: false,
  /** 源目录路径 */
  src: '',
  /** 输出目录路径 */
  desc: '',
  /** 是否尝试启用多线程模式(文件总数大于 mutiThreadMinCount 才有效) */
  mutiThread: true,
  /** 启用多线程模式的最小文件数，文件总数低于该值则使用单线程模式(最小值 1000，默认为 3000) */
  mutiThreadMinCount: 3000,
  /** 文件过滤规则，支持正则和普通的 glob 格式规则 */
  exclude: [], // [/\.pyc$/],
  /** 文件最小日期，低于该日期的忽略 */
  minDateTime: 0, // new Date('1970-01-01T00:00:00').getTime(),
  /** 文件<名称与大小均相同>已存在是否跳过。为 false 则覆盖它 */
  skipSameFile: true,
  /** 结束时回调方法 */
  onEnd: null,
  /** 发出进度消息时的回调方法 */
  onProgress: null,
};

export default config;
