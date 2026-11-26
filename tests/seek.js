#!/usr/bin/env node
// 再生位置の刻み（拍・小節・自由）とサブセットの表示名のテスト。
// 使い方: node tests/seek.js
'use strict';
const assert = require('assert');
const X = require('../src/ux_core.js');

const b44 = X.barInfo([], 4);
assert.deepStrictEqual([b44.len, b44.origin, b44.from], [4, 0, 'setting']);
const b34 = X.barInfo([{meter: [3, 4], start: 2}], 4);
assert.deepStrictEqual([b34.len, b34.origin, b34.from, b34.meter], [3, 2, 'part', '3/4']);
assert.strictEqual(X.barInfo([{meter: '6/8'}], 4).len, 3);
assert.strictEqual(X.barInfo([], 99).len, 16);

// 吸着
assert.strictEqual(X.snapSeek(5.4, 'beat', b44, 36), 5);
assert.strictEqual(X.snapSeek(5.6, 'beat', b44, 36), 6);
assert.strictEqual(X.snapSeek(5.6, 'bar', b44, 36), 4);
assert.strictEqual(X.snapSeek(6.1, 'bar', b44, 36), 8);
assert.strictEqual(X.snapSeek(5.37, 'free', b44, 36), 5.37);
assert.strictEqual(X.snapSeek(99, 'bar', b44, 36), 36);
assert.strictEqual(X.snapSeek(-3, 'beat', b44, 36), 0);
assert.strictEqual(X.snapSeek(4, 'bar', b34, 36), 5);   // 2 始まりの3拍子: 2,5,8…

// 前後への移動
assert.strictEqual(X.stepSeek(5, 1, 'beat', b44, 36, false), 6);
assert.strictEqual(X.stepSeek(5, -1, 'beat', b44, 36, false), 4);
assert.strictEqual(X.stepSeek(5.5, 1, 'free', b44, 36, false), 6);
assert.strictEqual(X.stepSeek(5, 1, 'bar', b44, 36, false), 8);
assert.strictEqual(X.stepSeek(8, -1, 'bar', b44, 36, false), 4);
assert.strictEqual(X.stepSeek(5, 1, 'beat', b44, 36, true), 8);    // Shift: 小節
assert.strictEqual(X.stepSeek(0, -1, 'beat', b44, 36, false), 0);
assert.strictEqual(X.stepSeek(36, 1, 'beat', b44, 36, false), 36);

// ものさし
const tk = X.rulerTicks(9, b44);
assert.strictEqual(tk.length, 10);
assert.deepStrictEqual(tk.filter(x => x.bar).map(x => [x.t, x.bar]), [[0, 1], [4, 2], [8, 3]]);
assert.deepStrictEqual(X.rulerTicks(8, b34).filter(x => x.bar).map(x => [x.t, x.bar]), [[2, 1], [5, 2], [8, 3]]);

// サブセットの表示名
const S = (name, sub) => ({name, sub: !!sub});
assert.deepStrictEqual(X.displayNames([S('1'), S('', 1), S('', 1), S('2'), S('', 1)]), ['1', '1A', '1B', '2', '2A']);
assert.deepStrictEqual(X.displayNames([S('1'), S('x', 1), S('', 1)]), ['1', 'x', '1B']);
assert.deepStrictEqual(X.displayNames([S('イントロ'), S('', 1)]), ['イントロ', 'イントロA']);
const many = [S('1')]; for (let i = 0; i < 28; i++) many.push(S('', 1));
const dn = X.displayNames(many);
assert.strictEqual(dn[26], '1Z'); assert.strictEqual(dn[27], '1AA');
console.log('seek / displayNames OK');
