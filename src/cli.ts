#!/usr/bin/env node

import commander from 'commander';
import { fastCopy } from './fast-copy';
import { dirRm } from './dir-rm';
import type { DfcConfig } from './type';

const pkg = require('../package.json');
const program = commander.program;

program.version(pkg.version, '-V, --version', '当前版本').helpOption('-h, --help', '查看帮助信息').description(pkg.description);

const cp = program
  .command('cp <srcPath> <destPath>')
  .description('高效的复制目录')
  .option('--debug', '调试模式', false)
  .option('-s, --slient', '静默模式', false)
  .option('-n, --threads <num>', '启动多线程的数量。小于 2 表示不启用多线程模式')
  .option('-N, --muti-thread-min-files <num>', '启用多线程的最小文件数，文件总数低于该值则使用单线程模式(最小值 1000，默认为 3000)', '3000')
  .option('-e, --exclude <reg...>', '文件排除规则。普通的 glob 规则，支持多个参数')
  .option('-d, --min-date-time <1970-01-01T00:00:00>', '文件最小日期，低于该日期的文件会被忽略(处理速度更快)')
  .option('--no-skip-same-file', '文件<名称与大小均相同>已存在时不跳过(覆盖)。')
  .option('-k, --skip-same-file', '文件<名称与大小均相同>已存在时则跳过。', true)
  .option('-i, --progress-interval', 'onProgress 进度回调(进度日志更新)的最小间隔时间(ms)，不低于 100ms。默认值 2000', '2000')
  .option('-c, --cp-during-stats', '多线程模式下，在收集文件信息过程中即开始文件复制（适用于文件数量多信息收集时间长的场景）', false)
  .option('-D, --delete-src', '是否删除原文件。即 mv 模式', false)
  .action((...args) => {
    const config: DfcConfig = {
      src: args[0],
      dest: args[1],
      iscmd: true,
      onEnd: () => process.exit(0),
      ...cp.opts(),
    };

    Object.keys(config).forEach((key) => {
      if (null == config[key]) delete config[key];
    });

    if (config.debug) console.debug('[cli][config]', config);

    fastCopy(config);
  });

const rm = program
  .command('rm <dirpath>')
  .description('删除一个目录及其子目录')
  .option('-f, --force', '强制删除，无需确认(否则删除前需确认)', false)
  .option('-s, --slient', '静默模式', false)
  .action(() => {
    dirRm(Object.assign({ src: rm.args }, rm.opts()));
  });

program.parse(process.argv);
