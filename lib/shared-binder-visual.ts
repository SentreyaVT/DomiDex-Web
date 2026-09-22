/** Direct port of PrivateBinderVisualEngine.kt: stable IDs, same atlases, crop and medium-quality geometry. */
export const coverIds = 'classic_rainbow aurora galaxy crystal nebula golden_shine void prism bubble flame ocean forest stardust electric chroma_shift pixel liquid_metal sunburst dragon_scale cosmic_dust'.split(' ');
const coverHighlights = 'FFC85C BB66FF E66DFF E7FCFF 42E8F5 FFED9A 777F8D 5BE5F2 D0B8FF FFDA75 6DE7FF B9FFD9 EF78EE A5FBFF 41E2ED 42E6EF E4ECF5 FFF0A6 B6D1E8 B869DF'.split(' ').map((color) => `#${color}`);
export const holoIds = 'classic_holo rainbow linear diagonal galaxy nebula aurora crystal prism diamond stardust bubble oil_slick liquid_metal hyper_wave fire ice pixel void holo_spark element_grass element_fire element_water element_electric element_psychic element_fighting element_darkness element_metal element_dragon element_colorless element_fairy'.split(' ');
const patterns = 'SHEEN SPECTRUM SHEEN DIAGONAL STARS WAVE WAVE FACETS FACETS FACETS STARS CONFETTI SPECTRUM SHEEN WAVE DIAGONAL FACETS CONFETTI SHEEN BURST WAVE DIAGONAL WAVE BURST WAVE BURST SHEEN FACETS FACETS STARS CONFETTI'.split(' ');
const palettes = [
  'FFFFFF B9E7FF E4D0FF', 'FF6688 63E5FF D778FF', 'FFFFFF 7DDFFF C68CFF', '57E8FF C25CFF FF75B7', '7F68FF DD69FF 64DFFF',
  '746BFF DD69FF 58DDEB', '69F7C5 67B8FF E879FF', '9FF8FF C5B4FF FFFFFF', '57E8FF D15DFF FFD06B', 'FFFFFF 8FDFFF D9C5FF',
  'FFFFFF A7C7FF D7A5FF', 'A7F5FF D0B5FF FFFFFF', '4BE2C5 6D55CE EF5FAE', 'FFFFFF 8593A8 DCE5EF', '66FFF0 8272FF FF7BD4',
  'FFB14C FF5D4F FFE7A1', 'FFFFFF 70DBFF A5BFFF', '5CEBFF B66AFF FFFFFF', '3B4252 705A96 8BA4B8', 'FFFFFF 9F72FF 5BE7FF',
  '57F28E B8FF66 FFFFFF', 'FF4C32 FFB21F FFF0A3', '38D9FF 287CFF FFFFFF', 'FFF26A 55E9FF FFFFFF', 'C85CFF 6E62FF FFA7F2',
  'FF8B38 E33F2F FFD67A', '24113F 7B3EC8 FF527D', 'FFFFFF AEC5DB FFD9A6', '44E4D5 FFC857 B65CFF', 'FFFFFF D9E6F2 FFE4B8', 'FF8FDF 8FE9FF FFFFFF',
].map((row) => row.split(' ').map((hex) => `#${hex}`));
const rainbow = ['#FF5F7E', '#FFD65C', '#72F59B', '#53E8FF', '#718BFF', '#D875FF'];
export type Tilt = { x: number; y: number };
export function sharedTilt(horizontal: number, vertical: number, reduceMotion = false): Tilt {
  const clamp = (value: number) => Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
  return reduceMotion ? { x: 0, y: 0 } : { x: -clamp(vertical) * 8, y: clamp(horizontal) * 8 };
}
export function holoMaterial(id: string) {
  const index = holoIds.indexOf(id);
  if (index < 0) return null;
  return { id, index: index < 20 ? index : index - 20, columns: index < 20 ? 5 : 4, rows: index < 20 ? 4 : 3, asset: index < 20 ? '/binder-materials/private_binder_holo_atlas.png' : '/binder-materials/private_binder_element_holo_atlas.png', pattern: patterns[index], colors: palettes[index] };
}
export function atlasCrop(width: number, height: number, columns: number, rows: number, index: number) {
  const cellWidth = Math.floor(width / columns), cellHeight = Math.floor(height / rows);
  const inset = Math.max(2, Math.round(Math.min(cellWidth, cellHeight) * .025));
  return { x: index % columns * cellWidth + inset, y: Math.floor(index / columns) * cellHeight + inset, width: cellWidth - inset * 2, height: cellHeight - inset * 2 };
}
export function holoGeometry(width: number, height: number, intensity: number, tilt: Tilt) {
  const value = Number.isFinite(intensity) ? Math.max(0, Math.min(1, intensity)) : 0;
  const tiltX = Number.isFinite(tilt.x) ? Math.max(-8, Math.min(8, tilt.x)) : 0;
  const tiltY = Number.isFinite(tilt.y) ? Math.max(-8, Math.min(8, tilt.y)) : 0;
  const horizontal = tiltY / 8 * width * .16, vertical = tiltX / 8 * height * .08;
  return { intensity: value, alpha: Math.min(.31, .04 + value * .13 + value * value * .18), materialAlpha: Math.min(.58, .05 + value * .20 + value * value * .33), horizontal, vertical, overscan: Math.min(width, height) * .16, materialX: horizontal * .70, materialY: vertical * .62, hue: 3 + (tiltY + tiltX * .45) / 8 * 1.35 };
}
const rgba = (hex: string, alpha: number) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${alpha})`;
const wrap = (value: number, bound: number) => ((value % bound) + bound) % bound;
function line(ctx: CanvasRenderingContext2D, color: string, x1: number, y1: number, x2: number, y2: number, width: number) {
  ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

/** Screen layer and SrcOver foil grooves are separate, matching Android compositing over artwork. */
export function drawSharedHolo(ctx: CanvasRenderingContext2D, atlas: CanvasImageSource & { width: number; height: number }, width: number, height: number, effectId: string, intensity: number, tilt: Tilt, layer: 'light' | 'grooves') {
  ctx.clearRect(0, 0, width, height);
  const material = holoMaterial(effectId), g = holoGeometry(width, height, intensity, tilt);
  if (!material || !g.intensity) return;
  const minimum = Math.min(width, height), colors = material.colors.map((color) => rgba(color, g.alpha));
  if (layer === 'grooves') {
    const alpha = Math.min(.405, .035 + g.intensity * .07 + g.intensity ** 2 * .30);
    for (let index = 0; index < 13; index++) {
      const position = wrap(g.hue + index * .62, rainbow.length), first = Math.floor(position), fraction = position - first;
      const channels = [1, 3, 5].map((offset) => Math.round(parseInt(rainbow[first].slice(offset, offset + 2), 16) * (1 - fraction) + parseInt(rainbow[(first + 1) % rainbow.length].slice(offset, offset + 2), 16) * fraction));
      const y = height * (index + 1) / 14 + g.vertical * .72;
      line(ctx, `rgba(${channels.join(',')},${alpha})`, -width * .08 + g.horizontal * .14, y + height * .055, width * 1.08 + g.horizontal * .14, y - height * .055, Math.max(.8, Math.min(2.5, minimum * .0052)));
    }
    return;
  }
  ctx.save(); ctx.globalCompositeOperation = 'screen';
  const crop = atlasCrop(atlas.width, atlas.height, material.columns, material.rows, material.index);
  ctx.globalAlpha = g.materialAlpha;
  ctx.drawImage(atlas, crop.x, crop.y, crop.width, crop.height, Math.round(-g.overscan + g.materialX), Math.round(-g.overscan + g.materialY), Math.round(width + 2 * g.overscan), Math.round(height + 2 * g.overscan));
  ctx.globalAlpha = 1;
  const gleamHalfWidth = width * (.1 + g.intensity * .035), gleamCenter = width * .5 + g.horizontal;
  const gleam = ctx.createLinearGradient(gleamCenter - gleamHalfWidth, -height * .1 + g.vertical, gleamCenter + gleamHalfWidth, height * 1.1 + g.vertical);
  const lightAlpha = Math.min(.18, .025 + g.intensity * .05 + g.intensity ** 2 * .11);
  gleam.addColorStop(0, 'transparent'); gleam.addColorStop(.25, rgba(material.colors[0], lightAlpha)); gleam.addColorStop(.5, rgba('#FFFFFF', Math.min(.28, .06 + g.intensity * .1 + g.intensity ** 2 * .12))); gleam.addColorStop(.75, rgba(material.colors[2], lightAlpha)); gleam.addColorStop(1, 'transparent');
  ctx.fillStyle = gleam; ctx.fillRect(0, 0, width, height);
  if (material.pattern === 'SHEEN' || material.pattern === 'SPECTRUM') {
    const sheen = ctx.createLinearGradient(width * .26 + g.horizontal, height + g.vertical, width * .74 + g.horizontal, g.vertical);
    ['transparent', ...colors, 'transparent'].forEach((color, index) => sheen.addColorStop(index / 4, color)); ctx.fillStyle = sheen; ctx.fillRect(0, 0, width, height);
  } else if (material.pattern === 'DIAGONAL') {
    for (let i = 0; i < 7; i++) { const x = width * i / 6 + g.horizontal; line(ctx, colors[i % 3], x - height * .35, height, x + height * .35, 0, minimum * .035); }
  } else if (material.pattern === 'WAVE') {
    for (let i = 0; i < 5; i++) { const y = height * (.16 + i * .18) + g.vertical; ctx.beginPath(); ctx.moveTo(-width * .08 + g.horizontal * .16, y); ctx.bezierCurveTo(width * .28 + g.horizontal * .10, y - height * .04, width * .70 + g.horizontal * .10, y + height * .05, width * 1.08 + g.horizontal * .16, y); ctx.strokeStyle = colors[i % 3]; ctx.lineWidth = minimum * .018; ctx.lineCap = 'round'; ctx.stroke(); }
  } else if (material.pattern === 'STARS' || material.pattern === 'CONFETTI') {
    for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.arc(wrap(width * ((i * 37) % 97) / 96 + g.horizontal * .22, width), wrap(height * ((i * 61) % 89) / 88 + g.vertical, height), minimum * (material.pattern === 'STARS' ? .012 : .018), 0, 2 * Math.PI); ctx.fillStyle = colors[i % 3]; ctx.fill(); }
  } else if (material.pattern === 'FACETS') {
    for (let i = 0; i < 5; i++) { const x = width * (.12 + i * .19) + g.horizontal * .14; ctx.beginPath(); ctx.moveTo(x, height * .12 + g.vertical); ctx.lineTo(x + width * .18, height * .48 + g.vertical); ctx.lineTo(x - width * .05, height * .86 + g.vertical); ctx.closePath(); ctx.fillStyle = colors[i % 3]; ctx.fill(); }
  } else if (material.pattern === 'BURST') {
    for (let i = 0; i < 7; i++) line(ctx, colors[i % 3], width * .5 + g.horizontal * .44, height * .5 + g.vertical * .7, width * i / 9, i % 2 === 0 ? 0 : height, minimum * .009);
  }
  ctx.restore();
}

export function drawSharedCover(ctx: CanvasRenderingContext2D, atlas: CanvasImageSource & { width: number; height: number }, width: number, height: number, id: string) {
  const index = coverIds.indexOf(id), crop = atlasCrop(atlas.width, atlas.height, 5, 4, index < 0 ? 4 : index);
  ctx.clearRect(0, 0, width, height); ctx.drawImage(atlas, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
  // Static Android phase .5 and default intensity .68: no extra autonomous animation on the web.
  const sheen = ctx.createLinearGradient(width * .18, height, width * .68, 0); sheen.addColorStop(0, 'transparent'); sheen.addColorStop(.5, rgba('#FFFFFF', .068)); sheen.addColorStop(1, 'transparent'); ctx.fillStyle = sheen; ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(width * .72, height * .24, 0, width * .72, height * .24, Math.min(width, height) * .68); glow.addColorStop(0, rgba(coverHighlights[index < 0 ? 4 : index], .18 * .68)); glow.addColorStop(1, 'transparent'); ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(width * .72, height * .24, Math.min(width, height) * .68, 0, 2 * Math.PI); ctx.fill();
  const spine = ctx.createLinearGradient(0, 0, width * .16, 0); spine.addColorStop(0, rgba('#000000', .78)); spine.addColorStop(.38, rgba('#000000', .34)); spine.addColorStop(1, 'transparent'); ctx.fillStyle = spine; ctx.fillRect(0, 0, width * .16, height);
  line(ctx, '#ffffff4d', width * .035, 0, width * .035, height, Math.max(1, width * .01)); line(ctx, '#0000009e', width * .105, 0, width * .105, height, Math.max(1, width * .015));
  const edge = ctx.createLinearGradient(width * .91, 0, width, 0); edge.addColorStop(0, 'transparent'); edge.addColorStop(.5, rgba('#FFFFFF', .30)); edge.addColorStop(1, rgba('#000000', .32)); ctx.fillStyle = edge; ctx.fillRect(width * .91, 0, width * .09, height);
  const vignette = ctx.createRadialGradient(width * .5, height * .5, 0, width * .5, height * .5, Math.max(width, height) * .72); vignette.addColorStop(0, 'transparent'); vignette.addColorStop(1, rgba('#000000', .34)); ctx.fillStyle = vignette; ctx.fillRect(0, 0, width, height);
}
