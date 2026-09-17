// Loader 兼容垫片:cordis-plugin-loader 按 "<package>/index.js" 约定解析入口,
// 不读 package.json 的 main/exports。真正实现在 ./lib/index.js,这里透明转发。
export * from './lib/index.js'
