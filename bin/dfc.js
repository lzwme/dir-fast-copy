#!/usr/bin/env node

// const colors = require('console-log-colors');
const pkg = require('../package.json');
const commander = require('commander');
const program = commander.program;
const { fastCopy, dirRm } = require('../dist');

program
  .version(pkg.version, '-V, --version', '当前版本')
  .helpOption('-h, --help', '查看帮助信息')
  .description(pkg.description);

// program.command('help').description('显示帮助信息');

const cp = program
  .command('cp <srcPath> <descPath>')
  .description('高效的复制目录')
  // .requiredOption('-S, --src <dir>', '要复制的源目录路径')
  // .requiredOption('-D, --desc <dir>', '要复制至的目的目录路径')
  .option('-s, --slient', '静默模式', false)
  .option('--no-muti-thread', '不启用多线程模式')
  .option('--muti-thread', '启用多线程模式(文件总数大于 --muti-thread-min-count 的值才有效)', true)
  .option('--exclude <reg...>', '文件排除规则。普通的 glob 规则，支持多个参数')
  .option('--min-date-time <1970-01-01T00:00:00>', '文件最小日期，低于该日期的文件会被忽略(处理速度更快)')
  .option('--no-skip-same-file', '文件<名称与大小均相同>已存在时不跳过(覆盖)。')
  .option('--skip-same-file', '文件<名称与大小均相同>已存在时则跳过。', true)
  .option(
    '--muti-thread-min-count',
    '启用多线程的最小文件数，文件总数低于该值则使用单线程模式(最小值 1000，默认为 3000)',
    3000
  )
  .option(
    '--cp-during-stats',
    '多线程模式下，在收集文件信息过程中即开始文件复制（适用于文件数量多信息收集时间长的场景）',
    false
  )
  .action((...args) => {
    const config = Object.assign(
      {
        src: args[0],
        desc: args[1],
        iscmd: true,
        // onEnd: () =>  process.exit(0),
      },
      cp.opts()
    );

    Object.keys(config).forEach((key) => {
      if (null == config[key]) delete config[key];
    });

    // console.log(config);
    fastCopy(config);
  });

const rm = program
  .command('rm <dirpath>')
  .description('删除一个目录及其子目录')
  .option('-f, --force', '强制删除，无需确认(否则删除前需确认)', false)
  .option('-s, --slient', '静默模式', false)
  .action((dirpath) => {
    const opts = rm.opts();
    opts.src = dirpath;
    dirRm(opts);
    // require('fs').rmdirSync(dirpath, { recursive: true });
  });

program.parse(process.argv);
