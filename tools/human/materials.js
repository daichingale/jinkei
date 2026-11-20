'use strict';
// 素材テーブル。color は sRGB の 0xRRGGBB、tint は「パートの色（上着の色）で塗る」素材
const list = [
  ['skin', 0xe6a27c, 0.5, 0.0, false],
  ['jacket', 0x808080, 0.82, 0.0, true],
  ['trim', 0xd7aa30, 0.34, 0.85, false],
  ['sash', 0xf1f1ee, 0.72, 0.0, false],
  ['pants', 0x10172f, 0.86, 0.0, false],
  ['shoe', 0x08080a, 0.2, 0.1, false],
  ['glove', 0xf2f2f4, 0.75, 0.0, false],
  ['hat', 0x0f1426, 0.8, 0.0, false],
  ['brim', 0x050507, 0.16, 0.15, false],
  ['plume', 0xfafafa, 1.0, 0.0, false],
  ['hair', 0x2b1d15, 0.55, 0.0, false],
  ['brass', 0xe0ac3c, 0.27, 1.0, false],
  ['silver', 0xd9dde3, 0.2, 1.0, false],
  ['blackwood', 0x121214, 0.32, 0.0, false],
  ['drumshell', 0x808080, 0.28, 0.1, true],
  ['drumhead', 0xf4f1e8, 0.55, 0.0, false],
  ['cloth', 0x808080, 0.5, 0.0, true],
  ['pole', 0xc9ced6, 0.28, 1.0, false],
  ['eye', 0x16100d, 0.25, 0.0, false],
  ['lip', 0xb8695f, 0.5, 0.0, false],
  ['leather', 0x0e0e10, 0.6, 0.0, false],
  ['wood', 0xc9a06a, 0.5, 0.0, false],
  ['felt', 0xeeeeea, 1.0, 0.0, false],
  ['cloth2', 0xf3f3f1, 0.55, 0.0, false],
  ['rosewood', 0x5a2716, 0.36, 0.0, false],
  ['cane', 0xd8b872, 0.6, 0.0, false],
  ['darksteel', 0x3a3c42, 0.35, 0.9, false],
  // ---- イラストの見た目（look illust）用。リアルでは使わない ----
  ['tshirt', 0xf7f7f5, 0.9, 0.0, false],
  ['ipants', 0x1c1d24, 0.9, 0.0, false],
  ['sneaker', 0xf3f3f1, 0.8, 0.0, false],
  ['sole', 0x1a1a1e, 0.8, 0.0, false],
  ['sleeve', 0x808080, 0.8, 0.0, true],
  ['iris', 0x806040, 0.3, 0.0, false],
  ['eyew', 0xffffff, 0.4, 0.0, false],
  ['blush', 0xf59a9a, 0.7, 0.0, false],
  ['mouth', 0x9c3b3b, 0.5, 0.0, false],
  // スネアの胴の黒い縞: リアルでは胴と同じ色（部隊色）、イラストでは黒
  ['stripe', 0x808080, 0.28, 0.1, true, {color: 0x17171c, tint: false}],
];
// イラストのときだけ素材色を差し替えるもの（素材名 → {color, tint}）
const ILL = {drumshell: {color: 0xf6f6f8, tint: false}};
const M = {list, ILL};
list.forEach((m, i) => { M[m[0].toUpperCase()] = i; });
module.exports = M;
