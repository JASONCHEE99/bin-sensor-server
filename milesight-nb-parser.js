// milesight-unified-em400-mud.js
// Unified TLV parser for Milesight EM400-MUD
// Supports: LoRaWAN (TTN/ChirpStack) and NB-IoT HTTP payloads
// Output: { sn, sensor: { battery, temperature_c, distance_mm, distance_cm, position, temperature_alarm, distance_alarm }, meta?, unknown: [...] }

'use strict';

/* ---------------- utils ---------------- */

function isBase64(str) {
  return typeof str === 'string' && /^[A-Za-z0-9+/=]+$/.test(str) && str.length % 4 === 0;
}

function toHex(input) {
  if (input == null) throw new Error('no payload');
  if (Buffer.isBuffer(input)) return input.toString('hex');
  if (Array.isArray(input)) return Buffer.from(input).toString('hex'); // bytes[]
  if (typeof input === 'string') {
    let s = input.trim();
    if (/^0x/i.test(s)) s = s.slice(2);
    if (isBase64(s)) {
      try { return Buffer.from(s, 'base64').toString('hex'); } catch (_) {}
    }
    if (!/^[0-9a-fA-F]+$/.test(s)) throw new Error('payload not hex/base64');
    return s.toLowerCase();
  }
  throw new Error('unsupported payload type');
}

function bytesToHex(bytes) {
  return Buffer.from(bytes || []).toString('hex');
}

function u8(hex2) {
  return parseInt(hex2, 16) & 0xff;
}

function u16le(hex4) {
  return parseInt(hex4.slice(2,4) + hex4.slice(0,2), 16) & 0xffff;
}

function i16le(hex4) {
  const v = u16le(hex4);
  return v > 0x7fff ? v - 0x10000 : v;
}

function hexSlice(hex, i, nBytes) {
  const end = i + nBytes * 2;
  if (end > hex.length) throw new Error('out of range');
  return hex.slice(i, end);
}

/* ---------------- core TLV ---------------- */

function parseTLV(hex) {
  if (hex.length % 2) throw new Error('odd-length hex');
  let i = 0;
  const out = { sensor: {}, unknown: [] };
  out.meta = {};

  while (i + 4 <= hex.length) {
    const ch   = hex.slice(i, i+2);
    const type = hex.slice(i+2, i+4);

    // FF/16 → SN (8B raw hex)
    if (ch === 'ff' && type === '16') {
      const vHex = hexSlice(hex, i+4, 8);
      out.sn = vHex;
      i += 4 + 8*2;
      continue;
    }

    // 01/75 → Battery 1B
    if (ch === '01' && type === '75') {
      const vHex = hexSlice(hex, i+4, 1);
      out.sensor.battery = u8(vHex); // %
      i += 4 + 1*2;
      continue;
    }

    // 03/67 → Temperature 2B (int16/10)
    if (ch === '03' && type === '67') {
      const vHex = hexSlice(hex, i+4, 2);
      out.sensor.temperature_c = i16le(vHex) / 10;
      i += 4 + 2*2;
      continue;
    }

    // 83/67 → Temperature + alarm (2B + 1B)
    if (ch === '83' && type === '67') {
      const tHex = hexSlice(hex, i+4, 2);
      const aHex = hexSlice(hex, i+8, 1);
      out.sensor.temperature_c = i16le(tHex) / 10;
      out.sensor.temperature_alarm = u8(aHex) === 1;
      i += 4 + 3*2;
      continue;
    }

    // 04/82 → Distance 2B (uint16 mm)
    if (ch === '04' && type === '82') {
      const dHex = hexSlice(hex, i+4, 2);
      const mm = u16le(dHex);
      out.sensor.distance_mm = mm;
      out.sensor.distance_cm = mm / 10;
      i += 4 + 2*2;
      continue;
    }

    // 84/82 → Distance + alarm (2B + 1B)
    if (ch === '84' && type === '82') {
      const dHex = hexSlice(hex, i+4, 2);
      const aHex = hexSlice(hex, i+8, 1);
      const mm = u16le(dHex);
      out.sensor.distance_mm = mm;
      out.sensor.distance_cm = mm / 10;
      out.sensor.distance_alarm = u8(aHex) === 1;
      i += 4 + 3*2;
      continue;
    }

    // 05/00 → Position 1B
    if (ch === '05' && type === '00') {
      const vHex = hexSlice(hex, i+4, 1);
      out.sensor.position = u8(vHex) === 0 ? 'normal' : 'tilt';
      i += 4 + 1*2;
      continue;
    }

    // Optional meta / downlink responses kept as unknown by default
    const lenMap = {
      'ff01': 1, // ipso version
      'ff09': 2, // hardware version
      'ff0a': 2, // firmware version
      'ffff': 2, // tsl version
      'ff0f': 1, // lorawan class
      'fffe': 1, // reset event
      'ff0b': 1, // device status
      // downlink responses (length heuristics)
      'fe02': 2, 'fe03': 2, 'fe10': 1, 'fe13': 1, 'fe1c': 2, 'fe28': 1,
      'fe3e': 1, 'fe4a': 1, 'fe56': 1, 'fe70': 2, 'fe71': 1, 'fe77': 2,
    };

    const key = ch + type;
    const lenBytes = lenMap[key];
    if (lenBytes && i + 4 + lenBytes*2 <= hex.length) {
      const rawHex = hexSlice(hex, i+4, lenBytes);
      out.unknown.push({ ch, type, len: lenBytes, rawHex });
      i += 4 + lenBytes*2;
      continue;
    }

    // cannot infer; record and stop to avoid mis-skip
    out.unknown.push({ ch, type, len: 0, rawHex: '' });
    break;
  }

  return out;
}

/* ---------------- NB-IoT entry ---------------- */

function parseNBIoTUplink(payload) {
  const hex = toHex(payload);
  return parseTLV(hex);
}

/* ---------------- LoRa entries (TTN/ChirpStack) ---------------- */

// ChirpStack v4
function decodeUplink(input) {
  const hex = bytesToHex(input.bytes || []);
  const data = parseTLV(hex);
  return { data };
}

// ChirpStack v3
function Decode(fPort, bytes) {
  const hex = bytesToHex(bytes || []);
  return parseTLV(hex);
}

// TTN V2/V3
function Decoder(bytes, port) {
  const hex = bytesToHex(bytes || []);
  return parseTLV(hex);
}

/* ---------------- exports ---------------- */

module.exports = {
  // core
  parseTLV,
  // NB-IoT
  parseNBIoTUplink,
  // LoRa wrappers
  decodeUplink,
  Decode,
  Decoder,
  // helpers
  toHex, bytesToHex, u16le, i16le,
};
