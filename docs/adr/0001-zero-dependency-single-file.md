# 零依赖单文件, 不内置 Shiki

插件保持 `lib/client.js` 单文件, 零 npm 依赖, 无构建步骤; Shiki 首次使用时从 CDN 懒加载, 不打包进仓库. 实测 CDN 首包约 1.2s / 418B, 6 个级联约 67KB, 加 `onig.wasm` 466KB; DSH 客户端模块的 `require` 表只认已注册模块, platform seed 与 `./client.*.js` chunk, 不认裸 npm id, 所以内置还要额外引入构建步骤.

代价是首次高亮依赖网络, 收益是任何会话只注入约 55KB 脚本, 安装无需构建, 且不会影响没有代码块的会话. 内置 Shiki 会让脚本涨到数 MB 并让所有会话都多载一份, 反而更慢. 内置正则分词器已经同步上色(零网络等待), 所以 CDN 只影响后台升级的着色质量, 不影响首次出现时间. 若日后 `dsh-app://` 下动态 `import()` 长期不可用, 再重新评估.

**Considered Options**: 打包 Shiki 进单文件(体积数 MB), 拆 `./client.*.js` chunk(需拼装脚本), 复用本地 `profiles/node_modules/shiki`(不在注入图内, 页面拿不到). 三者都被否决.
