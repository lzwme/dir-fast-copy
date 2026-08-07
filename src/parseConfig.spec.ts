import { describe, expect, it } from 'vitest';
import { parseConfig } from './parseConfig';

describe('parseConfig', () => {
  it('未指定源目录应返回 undefined', () => {
    const a = parseConfig({ src: null, dest: null });
    expect(a).toBeUndefined();
  });

  it('源目录不存在应返回 undefined', () => {
    const b = parseConfig({
      src: `test${Math.random()}`,
      dest: 'test',
    });
    expect(b).toBeUndefined();
  });

  it('正常配置应解析成功', () => {
    const c = parseConfig({
      src: './dist',
      dest: './test/dist-dest',
    });
    expect(c).toBeDefined();
    expect(c?.src).toBeDefined();
    expect(c?.dest).toBeDefined();
  });

  it('定义文件排除规则后应解析成功', () => {
    const d = parseConfig({
      src: './dist',
      dest: './test/dist-dest',
      exclude: ['test/**', /test/],
    });
    expect(d).toBeDefined();
    expect(d?.exclude).toBeDefined();
    // glob 字符串应被转换为 RegExp
    expect(d?.exclude?.[0]).toBeInstanceOf(RegExp);
  });

  it('源目录与目的目录相同时应返回 undefined', () => {
    const e = parseConfig({
      src: './dist',
      dest: './dist',
    });
    expect(e).toBeUndefined();
  });

  it('mutiThreadMinFiles 低于 1000 时应使用默认值', () => {
    const f = parseConfig({
      src: './dist',
      dest: './test/dest',
      mutiThreadMinFiles: 500,
    });
    expect(f?.mutiThreadMinFiles).toBe(3000);
  });
});
