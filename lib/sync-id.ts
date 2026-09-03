function rotateLeft(value: number, shift: number) {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

function md5(input: Uint8Array) {
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(input);
  buffer[input.length] = 0x80;
  const view = new DataView(buffer.buffer);
  const bitLength = input.length * 8;
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const constants = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 2 ** 32) >>> 0);

  for (let offset = 0; offset < buffer.length; offset += 64) {
    const words = Array.from({ length: 16 }, (_, index) => view.getUint32(offset + index * 4, true));
    let a = a0; let b = b0; let c = c0; let d = d0;
    for (let index = 0; index < 64; index += 1) {
      let mixed: number; let wordIndex: number;
      if (index < 16) { mixed = (b & c) | (~b & d); wordIndex = index; }
      else if (index < 32) { mixed = (d & b) | (~d & c); wordIndex = (5 * index + 1) % 16; }
      else if (index < 48) { mixed = b ^ c ^ d; wordIndex = (3 * index + 5) % 16; }
      else { mixed = c ^ (b | ~d); wordIndex = (7 * index) % 16; }
      const next = d;
      d = c;
      c = b;
      const sum = (a + mixed + constants[index] + words[wordIndex]) >>> 0;
      b = (b + rotateLeft(sum, shifts[index])) >>> 0;
      a = next;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const digest = new Uint8Array(16);
  const digestView = new DataView(digest.buffer);
  digestView.setUint32(0, a0, true);
  digestView.setUint32(4, b0, true);
  digestView.setUint32(8, c0, true);
  digestView.setUint32(12, d0, true);
  return digest;
}

function nameUuidV3(value: string) {
  const bytes = md5(new TextEncoder().encode(value));
  bytes[6] = (bytes[6] & 0x0f) | 0x30;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function identityKey(parts: Array<string | number>) {
  return parts.map((part) => String(part).trim().toLocaleLowerCase('en-US')).join('|');
}

export function deterministicSourceSyncId(ownerUid: string, setId: string, cardId: string, condition: string, finish: string, variant: string) {
  return nameUuidV3(identityKey([ownerUid, setId, cardId, condition, finish, variant]));
}

export function deterministicCardmarketSyncId(ownerUid: string, productId: number, condition: string, finish: string, variant: string) {
  return nameUuidV3(identityKey([ownerUid, 'cardmarket', productId, condition, finish, variant]));
}
