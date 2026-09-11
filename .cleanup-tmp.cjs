// 临时脚本：清理本次验证过程中在 tmp/ 下产生的测试数据，执行后即删除
// 注意：复制时保留了源文件的只读属性，直接 rm 会失败，需先清除只读位
const fs = require('fs');
const path = require('path');

/** 递归清除只读属性 */
function clearReadonly(target) {
  let entries;
  try {
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const child = path.join(target, entry.name);
    try {
      fs.chmodSync(child, 0o666);
    } catch {
      // 忽略
    }
    if (entry.isDirectory()) clearReadonly(child);
  }

  try {
    fs.chmodSync(target, 0o666);
  } catch {
    // 忽略
  }
}

const tmpDir = path.resolve(__dirname, 'tmp');
if (!fs.existsSync(tmpDir)) {
  console.log('tmp/ 不存在，无需清理');
  process.exit(0);
}

for (const name of fs.readdirSync(tmpDir)) {
  const target = path.join(tmpDir, name);
  clearReadonly(target);
  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    console.log('removed:', name);
  } catch (err) {
    const detail = err.errors ? err.errors.slice(0, 3).map((e) => `${e.code} ${e.path}`).join(' | ') : err.message;
    console.log('failed:', name, detail);
  }
}

try {
  fs.rmdirSync(tmpDir);
  console.log('removed: tmp/');
} catch (err) {
  console.log('failed: tmp/', err.code || err.message);
}
