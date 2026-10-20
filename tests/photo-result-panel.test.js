const test = require('node:test');
const assert = require('node:assert/strict');
let component;
global.Component = definition => { component = definition; };
require('../miniprogram/components/photo-panel/index'); delete global.Component;
test('newly edited results leave original comparison and display the saved crop, including original-background crops', () => {
  const p = { data: { ...component.data }, setData(data) { Object.assign(this.data, data); } };
  const original = { state: 'done', original: '/photo.png', subject: '/cutout.png', kind: 'extracted' };
  component.observers.task.call(p, original); p.data.showOriginal = true;
  component.observers.task.call(p, { ...original, subject: '/cropped.png' });
  assert.equal(p.data.showOriginal, false); assert.equal(p.data.displayImage, '/cropped.png');
  component.observers.task.call(p, { ...original, subject: '/cropped-background.png', kind: 'original' });
  assert.equal(p.data.displayImage, '/cropped-background.png'); assert.equal(p.data.canCompare, false);
});
