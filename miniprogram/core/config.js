// Geometry uses the inner felt's logical units, independent of screen size.
module.exports = {
  board: { width: 1500, height: 1000, inset: 45, radius: 90, innerRadius: 45, overhang: 288 },
  colors: [
    { name: '燕麦米', value: '#D9CBAF' },
    { name: '鼠尾草', value: '#C3D0BD' },
    { name: '暖灰', value: '#D4D0C8' },
    { name: '藕粉', value: '#DDC7C1' },
    { name: '雾蓝', value: '#C4D2D6' },
    { name: '奶油黄', value: '#E6DABB' }
  ],
  defaultTexture: 'fine',
  textures: [
    { name: '细绒', value: 'fine', description: '细密轻柔' },
    { name: '长绒', value: 'long', description: '舒展纤维' },
    { name: '交织', value: 'cross', description: '交错肌理' }
  ],
  scaleStep: 1.1, rotationStep: 15, minSize: 110, maxSize: 850, historyLimit: 30,
  maxItems: 30, maxImageBytes: 15 * 1024 * 1024, maxText: 1000,
  maxThemes: 50, maxBoardTitle: 30,
  maxLibraries: 100, maxLibraryTitle: 30,
  categories: ['未分类', '饮食', '自然', '出行', '日常', '心情'],
  exportWidth: 1800,
  // Supply a trusted HTTPS image-processing backend, never a vendor secret.
  extraction: { mode: 'remote', endpoint: 'https://api.jiejiezi.cn/extract', auth: 'wechat', timeout: 60000 }
};
