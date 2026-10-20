const test = require('node:test');
const assert = require('node:assert/strict');
const geometry = require('../miniprogram/core/geometry');
const B = require('../miniprogram/core/config').board;

test('a held rotation grip follows the finger arc across every quadrant instead of chasing the bounding box', () => {
  const width = 390, height = 660, s = width / B.width;
  const p = { memoryId: 'test', x: 705, y: height / s / 2 - B.inset, width: 300, height: 530, angle: 0 };
  const center = { x: (B.inset + p.x) * s, y: (B.inset + p.y) * s };
  const initial = geometry.handles(p, width, height);
  for (let angle = -360; angle <= 360; angle += 3) {
    const radians = angle * Math.PI / 180;
    const actual = geometry.handles({ ...p, angle }, width, height);
    for (let i = 0; i < initial.length; i++) {
      const dx = initial[i].x - center.x, dy = initial[i].y - center.y;
      assert.equal(actual[i].op, initial[i].op);
      assert.ok(Math.abs(actual[i].x - (center.x + dx * Math.cos(radians) - dy * Math.sin(radians))) < .001);
      assert.ok(Math.abs(actual[i].y - (center.y + dx * Math.sin(radians) + dy * Math.cos(radians))) < .001);
    }
  }
});

test('corner targets remain visible, separate and continuous near board edges while scaling and rotating', () => {
  for (const width of [240, 320, 412]) for (const height of [width * 2 / 3, width * 1.8]) {
    for (const shape of [[110, 70], [850, 50], [300, 530]]) for (const x of [0, 705, 1410]) for (const y of [0, 455, 1800]) {
      let previous;
      for (let angle = 0; angle <= 360; angle++) {
        const hs = geometry.handles({ memoryId:'test', x, y, width:shape[0], height:shape[1], angle }, width, height);
        for (const h of hs) assert.ok(h.x >= 22 - .001 && h.x <= width - 22 + .001 && h.y >= 22 - .001 && h.y <= height - 22 + .001);
        for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) {
          assert.ok(Math.abs(hs[i].x - hs[j].x) >= 44 || Math.abs(hs[i].y - hs[j].y) >= 44);
        }
        if (previous) hs.forEach((h, i) => assert.ok(Math.hypot(h.x - previous[i].x, h.y - previous[i].y) < 8, 'No corner swaps at a quadrant or viewport edge'));
        previous = hs;
      }
    }
  }
});
