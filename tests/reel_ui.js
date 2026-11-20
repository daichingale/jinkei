#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const {jinkeiCompile} = require('../web/engine.js');
const {jkReel} = require('../src/reel.js');
const ctx = {};
vm.runInNewContext(fs.readFileSync(require.resolve('../src/motion.js'), 'utf8') + '\nthis.jkState=jkState; this.jkFacing=jkFacing;', ctx);
global.jkState = ctx.jkState;
global.jkFacing = ctx.jkFacing;
const d = jinkeiCompile(fs.readFileSync('examples/snare.jk', 'utf8'));
assert(d.ok, 'snare.jk must compile');
assert.equal(d.data.performers.length, 7);
const D = d.data;
const all = jkReel.viewOf(D, 10, {mode:'all'});
const allLate = jkReel.viewOf(D, 40, {mode:'all'});
assert.deepEqual(all, allLate, 'all mode must be static');
const follow = jkReel.viewOf(D, 10, {mode:'follow'});
assert.notDeepEqual(all, follow, 'follow mode should follow the formation');
const one = jkReel.viewOf(D, 10, {mode:'follow', zoom:1});
const close = jkReel.viewOf(D, 10, {mode:'follow', zoom:1.3});
assert(close[1] - close[0] < one[1] - one[0], 'higher zoom narrows the view');
for(const t of [0, 8, 16, 32, D.total]) {
  for(const fn of [jkReel.diag, jkReel.front]) {
    const far = fn(D, t, 1.8, .8), near = fn(D, t, 1.8, 1.5);
    const dist = c => Math.hypot(...c.eye.map((v,i)=>v-c.target[i]));
    assert(dist(near) < dist(far), 'zoom should move camera toward target');
    assert([...near.eye,...near.target,near.fov].every(Number.isFinite), 'camera must be finite');
  }
}
// 全員が右へ移動しても正面カメラが追従する。
const shifted = structuredClone(D);
for (const s of shifted.sets) for (const p of s.pos) p[0] += 9 / shifted.unit_m;
const f = jkReel.front(shifted, 16, 1.9);
assert(f.eye[0] > 8, `front camera should track x, got ${f.eye[0]}`);
console.log('OK reel_ui: compilation, static/follow grid, zoom, smooth camera, horizontal tracking');
