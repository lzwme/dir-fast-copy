const fs = require('fs');
const msgPath = process.argv[2] || './.git/COMMIT_EDITMSG';
if (!fs.existsSync(msgPath)) process.exit();

const { color } = require('console-log-colors');
const msg = removeComment(fs.readFileSync(msgPath, 'utf-8').trim());
const commitRE =
  /^(revert: )?(feat|fix|docs|style|refactor|perf|test|workflow|build|ci|chore|types|wip|release|dep|example|Merge)(\(.+\))?: .{1,50}/;

if (!commitRE.test(msg)) {
  console.log();
  console.error(
    `  ${color.red(color.bgRed(' ERROR '))} ${color.red(
      `invalid commit message format.`,
    )}\n\n` +
    color.red(
      `  Proper commit message format is required for automated changelog generation. Examples:\n\n`,
    ) +
    `    ${color.green(`feat(bundler-webpack): add 'comments' option`)}\n` +
    `    ${color.green(`fix(core): handle events on blur (close #28)`)}\n\n` +
    color.red(`  See .github/commit-convention.md for more details.\n`),
  );
  process.exit(1);
}

function removeComment(msg) {
  return msg.replace(/^#.*[\n\r]*/gm, '');
}
