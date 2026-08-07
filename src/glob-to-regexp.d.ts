declare module 'glob-to-regexp' {
  interface GlobToRegExpOptions {
    extended?: boolean;
    globstar?: boolean;
    flags?: string;
  }
  function globToRegExp(glob: string, opts?: GlobToRegExpOptions): RegExp;
  export = globToRegExp;
}
