const test = require('node:test');
const assert = require('node:assert/strict');
const { layout } = require('../miniprogram/core/journal-header');

test('custom header clears the real status bar and system capsule across devices', () => {
  for (const [width, status, top, height, left] of [[390,47,51,32,294],[320,20,24,32,224],[430,59,63,32,334],[375,24,32,32,279]]) {
    const result = layout({windowWidth:width,statusBarHeight:status},{top,height,left});
    assert.equal(result.headerStatus,status);
    assert.ok(result.headerHeight>=top+height);
    assert.ok(width-result.headerMenuInset<=left-8);
    assert.ok(result.headerHeight-status>=44);
  }
});
test('missing menu and status metrics retain a usable navigation area', () => {
  assert.deepEqual(layout(),{headerStatus:20,headerHeight:64,headerMenuInset:104});
  for (const menu of [{},{top:0,height:0,left:0},{top:NaN,height:32,left:280},{top:28,height:32,left:30}]) {
    assert.deepEqual(layout({windowWidth:375,statusBarHeight:24},menu),{headerStatus:24,headerHeight:68,headerMenuInset:104});
  }
});
