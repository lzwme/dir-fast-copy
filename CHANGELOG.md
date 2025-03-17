# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [1.6.0](https://github.com/lzwme/dir-fast-copy/compare/v1.5.0...v1.6.0) (2025-03-17)


### Features

* 新增 include 参数，支持指定文件包含规则 ([eeee0fa](https://github.com/lzwme/dir-fast-copy/commit/eeee0faa3799424426709352dcbb0a66570acf56))

## [1.5.0](https://github.com/lzwme/dir-fast-copy/compare/v1.4.1...v1.5.0) (2023-12-14)


### Features

* 新增 deleteSrc 参数，可选择复制成功后是否删除源文件（即mv模式） ([0531e9a](https://github.com/lzwme/dir-fast-copy/commit/0531e9a7eb25658ff5fb174cde7b39b93c0fcf37))

### [1.4.1](https://github.com/lzwme/dir-fast-copy/compare/v1.4.0...v1.4.1) (2022-11-02)


### Bug Fixes

* 更正 cpFile 等待逻辑 ([a9742a9](https://github.com/lzwme/dir-fast-copy/commit/a9742a9070b88e7e2b1b27b03fca9abe986ad840))
* 修复 exclude 参数不生效的问题 ([a0b49af](https://github.com/lzwme/dir-fast-copy/commit/a0b49afec063e82a5587c98c7481cd5a357b233b))

## 1.4.0 (2022-06-22)


### Features

* 新增 cpDuringStats 参数，用于指定多线程模式下在收集文件信息过程中是否进行文件复制(默认所有文件信息收集完毕才开始) ([8c5d9cc](https://github.com/lzwme/dir-fast-copy/commit/8c5d9cc4ea0c592222f9a1c2d072e7151d3c3a88))
* 增加显示复制文件的大小信息；更新依赖 ([90e342e](https://github.com/lzwme/dir-fast-copy/commit/90e342ea34483da044846e776361199145e4ca50))


### Bug Fixes

* 修正单词简写错误 desc -> dest (close [#1](https://github.com/lzwme/dir-fast-copy/issues/1)) ([715c8b8](https://github.com/lzwme/dir-fast-copy/commit/715c8b8d7b69fef10196da55419e7f8628b38780))
* console-log-colors 依赖应放到 dependencies 中 ([5788e00](https://github.com/lzwme/dir-fast-copy/commit/5788e0046399b58af1f3778227faf0ab7d65ce97))

## 1.3.0 (2022-04-20)


### Features

* 新增 cpDuringStats 参数，用于指定多线程模式下在收集文件信息过程中是否进行文件复制(默认所有文件信息收集完毕才开始) ([8c5d9cc](https://github.com/lzwme/dir-fast-copy/commit/8c5d9cc4ea0c592222f9a1c2d072e7151d3c3a88))
* 增加显示复制文件的大小信息；更新依赖 ([90e342e](https://github.com/lzwme/dir-fast-copy/commit/90e342ea34483da044846e776361199145e4ca50))


### Bug Fixes

* console-log-colors 依赖应放到 dependencies 中 ([5788e00](https://github.com/lzwme/dir-fast-copy/commit/5788e0046399b58af1f3778227faf0ab7d65ce97))

## 1.2.0 (2020-09-23)


### Features

* 新增 cpDuringStats 参数，用于指定多线程模式下在收集文件信息过程中是否进行文件复制(默认所有文件信息收集完毕才开始) ([8c5d9cc](https://github.com/lzwme/dir-fast-copy/commit/8c5d9cc4ea0c592222f9a1c2d072e7151d3c3a88))

### Bug Fixes

* console-log-colors 依赖应放到 dependencies 中 ([5788e00](https://github.com/lzwme/dir-fast-copy/commit/5788e0046399b58af1f3778227faf0ab7d65ce97))

### 1.0.0 (2020-09-21)

* init

### Features

* TODO