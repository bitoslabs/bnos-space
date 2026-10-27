/**
 * Bech32 (npub) encoding and decoding.
 */
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

export function isHex64(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function polymod(values) {
  const gen = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i += 1) {
      if ((top >> i) & 1) chk ^= gen[i];
    }
  }
  return chk;
}

function hrpExpand(hrp) {
  const out = [];
  for (let i = 0; i < hrp.length; i += 1) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i += 1) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

function convertBits(data, from, to, pad) {
  let acc = 0;
  let bits = 0;
  const out = [];
  const maxValue = (1 << to) - 1;
  for (const value of data) {
    if (value < 0 || value >> from) throw new Error("Invalid bech32 data");
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxValue);
    }
  }
  if (pad) {
    if (bits > 0) out.push((acc << (to - bits)) & maxValue);
  } else if (bits >= from || ((acc << (to - bits)) & maxValue)) {
    throw new Error("Invalid bech32 padding");
  }
  return out;
}

function decode(value) {
  const str = String(value || "").toLowerCase();
  if (str.length < 8 || str.length > 200) {
    throw new Error("Invalid bech32 key");
  }
  const split = str.lastIndexOf("1");
  if (split < 1 || split + 7 > str.length) {
    throw new Error("Invalid bech32 key");
  }
  const hrp = str.slice(0, split);
  const data = [];
  for (const ch of str.slice(split + 1)) {
    const index = CHARSET.indexOf(ch);
    if (index === -1) throw new Error("Invalid bech32 character");
    data.push(index);
  }
  if (polymod([...hrpExpand(hrp), ...data]) !== 1) {
    throw new Error("Invalid bech32 checksum");
  }
  return { hrp, words: data.slice(0, -6) };
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex) {
  if (!isHex64(hex)) throw new Error("Invalid public key");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function encode(hrp, words) {
  const data = [...words];
  const check =
    polymod([...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = [];
  for (let i = 0; i < 6; i += 1) {
    checksum.push((check >> (5 * (5 - i))) & 31);
  }
  return (
    hrp +
    "1" +
    [...data, ...checksum].map((value) => CHARSET[value]).join("")
  );
}

export function npubToHex(npub) {
  const { hrp, words } = decode(npub);
  if (hrp !== "npub") throw new Error("Not an npub");
  const bytes = convertBits(words, 5, 8, false);
  if (bytes.length !== 32) throw new Error("Invalid npub length");
  return bytesToHex(bytes);
}

export function hexToNpub(hex) {
  try {
    const words = convertBits(Array.from(hexToBytes(hex)), 8, 5, true);
    return encode("npub", words);
  } catch {
    return String(hex || "");
  }
}

export function nsecToHex(nsec) {
  const { hrp, words } = decode(nsec);
  if (hrp !== "nsec") throw new Error("Not an nsec");
  const bytes = convertBits(words, 5, 8, false);
  if (bytes.length !== 32) throw new Error("Invalid nsec length");
  return bytesToHex(bytes);
}

export function hexToNsec(hex) {
  const words = convertBits(Array.from(hexToBytes(hex)), 8, 5, true);
  return encode("nsec", words);
}
