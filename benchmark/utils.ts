import { execSync } from "child_process";
import { resolve } from "path";

export const rootDir = resolve(__dirname, '..');

export function runCmd(cmd: string, debug = false) {
  return execSync(cmd, { encoding: 'utf8', stdio: debug ? 'inherit' : 'pipe' });
}

export async function calcTimeCost(fn, label = '') {
  const startTime = process.hrtime.bigint();
  await fn();
  const endTime = process.hrtime.bigint();
  const timeCost = Number(endTime - startTime);

  console.log(`[${label || fn.name}] timeCost:`, timeCost / 1e9, 's');

  return timeCost;
}
