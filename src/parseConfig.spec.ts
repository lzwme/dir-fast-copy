import test from 'ava';
import { parseConfig } from './parseConfig';

test('parseConfig', (t) => {
  const a = parseConfig({ src: null, desc: null });
  t.is(a, void 0, '未指定源目录');

  const b = parseConfig({
    src: 'test' + Math.random(),
    desc: 'test',
  });

  t.is(b, void 0, '源目录不存在');

  const c = parseConfig({
    src: './dist',
    desc: './test/dist-desc',
  });

  t.is(c !== void 0, true);

  const d = parseConfig({
    src: './dist',
    desc: './test/dist-desc',
    exclude: ['test/**', /test/],
  });

  t.is(d !== void 0, true, '定义文件排除规则');
});
