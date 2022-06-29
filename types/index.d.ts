export interface DfcConfig {
  debug?: boolean;
  /** 源目录路径 */
  src: string;
  /** 输出目录路径 */
  dest: string;
  /** 是否静默模式 */
  slient?: boolean;
  /** 是否为 cmd 命令方式调用(dfc --src --dest) */
  iscmd?: boolean;
  /** 多线程模式的线程数。小于2表示不启动多线程模式 */
  threads?: number;
  /** 启用多线程模式的最小文件数，文件总数低于该值则使用单线程模式(最小值 1000，默认为 3000) */
  mutiThreadMinFiles?: number;
  /** 文件过滤规则，支持正则和普通的 glob 格式规则 */
  exclude?: any[]; // [/\.pyc$/],
  /** 文件最小日期，低于该日期的忽略 */
  minDateTime?: number;
  /** 文件<名称与大小均相同>已存在是否跳过。为 false 则覆盖它 */
  skipSameFile?: boolean;
  /** 多线程模式下，在收集文件信息过程中即启动文件复制（适用于文件数量多、信息收集时间长的场景。默认为 false，在信息收集完毕后才启动） */
  cpDuringStats?: boolean;
  /** onProgress 进度回调(进度日志更新)的最小间隔时间(ms)，不低于 100ms。默认值 2000 */
  progressInterval?: number;
  /** 结束时回调方法 */
  onEnd?: (stats: DfcStats) => void;
  /** 发出进度消息时的回调方法 */
  onProgress?: (stats: DfcStats) => void;
}

export interface FsStatInfo {
  isFile?: boolean;
  nlink?: number;
  isDirectory: boolean;
  atimeMs: number;
  mtimeMs: number;
  size: number;
};

export interface DfcStats {
  /** 全部的文件路径 [src, dest] */
  allFilePaths?: { src: string; dest: string; srcStat: FsStatInfo }[];
  /** 全部的目录路径 src?: dest */
  allDirPaths?: { src: string; dest: string; srcStat: FsStatInfo }[];
  /** 文件总数 */
  totalFile?: number;
  /** 所有文件的大小之和 */
  totalFileSize?: number;
  /** 已处理的文件总数 */
  totalFileHandler?: number;
  /** 已复制的文件总数 */
  totalFileNew?: number;
  /** 已复制的文件大小之和 */
  totalFileNewSize?: number;
  /** 文件夹总数 */
  totalDir?: number;
  /** 复制过程中新建的文件夹数 */
  totalDirNew?: number;
}

interface PlainObject {
  [key: string]: any;
}

export interface DfcDirRmOptions {
  src: string[];
  force?: boolean;
  slient?: DfcConfig['slient'];
}
