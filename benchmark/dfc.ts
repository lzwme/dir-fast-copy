import { mkdirSync, rmSync } from "fs";
import { resolve } from "path";
import { runCmd, calcTimeCost } from "./utils";

const rootDir = resolve(__dirname, '..');
const src = resolve(rootDir, `node_modules`);

function dfc(threads = 1, debug = false) {
  const dest = resolve(rootDir, `tmp/dfc-threads-${threads}-nm`);
  runCmd(`node bin/dfc.js cp --threads=${threads} "${src}" "${dest}"`);
}
function xcopy(debug = false) {
  if (process.platform !== 'win32') return;
  const dest = resolve(rootDir, `tmp/xcopy-nm`);
  mkdirSync(dest, { recursive: true });
  runCmd(`XCOPY "${src}" "${dest}" /E /Y` + (debug ? '' : ' /Q'));
}

async function testStart() {
  rmSync('tmp', { recursive: true });

  // for xcopy
  await calcTimeCost(() => xcopy(), 'xcopy');

  // for dfc
  const threadList = [1, 2, 4, 8];
  for (const thread of threadList) {
    await calcTimeCost(() => dfc(thread), `dfc-thread-${thread}`);
  }
}

testStart();
