'use strict';

const crypto = require('crypto');

function isBase64(str) {
  return typeof str === 'string' && /^[A-Za-z0-9+/=]+$/.test(str) && str.length % 4 === 0;
}

function normalizeInput(payload) {
  if (payload == null) {
    throw new Error('No payload provided');
  }

  if (Buffer.isBuffer(payload)) {
    return payload.toString('hex');
  }

  if (Array.isArray(payload)) {
    return Buffer.from(payload).toString('hex');
  }

  if (typeof payload === 'string') {
    let candidate = payload.trim();
    if (candidate.startsWith('0x') || candidate.startsWith('0X')) {
      candidate = candidate.slice(2);
    }

    if (/^[0-9a-fA-F]+$/.test(candidate)) {
      if (candidate.length % 2 !== 0) {
        throw new Error('Hex payload length must be even');
      }
      return candidate.toLowerCase();
    }

    if (isBase64(candidate)) {
      return Buffer.from(candidate, 'base64').toString('hex');
    }
  }

  throw new Error('Unsupported payload format');
}

function asUInt8(hex) {
  return parseInt(hex, 16) & 0xff;
}

function asUInt16LE(hex) {
  if (hex.length !== 4) throw new Error('Expected 2 bytes for uint16');
  return parseInt(hex.slice(2, 4) + hex.slice(0, 2), 16) & 0xffff;
}

function asInt16LE(hex) {
  const value = asUInt16LE(hex);
  return value > 0x7fff ? value - 0x10000 : value;
}

function sliceHex(hex, start, byteLength) {
  const end = start + byteLength * 2;
  if (end > hex.length) throw new Error('Slice out of range');
  return hex.slice(start, end);
}

function parseTLV(hex) {
  const result = {
    sensor: {},
    meta: {},
    unknown: [],
  };

  let cursor = 0;
  while (cursor + 4 <= hex.length) {
    const channel = hex.slice(cursor, cursor + 2);
    const type = hex.slice(cursor + 2, cursor + 4);
    cursor += 4;

    const key = `${channel}${type}`;

    switch (key) {
      case 'ff16': {
        const snHex = sliceHex(hex, cursor, 8);
        result.sn = snHex;
        cursor += 16;
        continue;
      }
      case '0175': {
        const batteryHex = sliceHex(hex, cursor, 1);
        result.sensor.battery = asUInt8(batteryHex);
        cursor += 2;
        continue;
      }
      case '0367': {
        const temperatureHex = sliceHex(hex, cursor, 2);
        result.sensor.temperature_c = asInt16LE(temperatureHex) / 10;
        cursor += 4;
        continue;
      }
      case '8367': {
        const temperatureHex = sliceHex(hex, cursor, 2);
        const alarmHex = sliceHex(hex, cursor + 4, 1);
        result.sensor.temperature_c = asInt16LE(temperatureHex) / 10;
        result.sensor.temperature_alarm = asUInt8(alarmHex);
        cursor += 6;
        continue;
      }
      case '0482': {
        const distanceHex = sliceHex(hex, cursor, 2);
        const mm = asUInt16LE(distanceHex);
        result.sensor.distance_mm = mm;
        result.sensor.distance_cm = mm / 10;
        cursor += 4;
        continue;
      }
      case '8482': {
        const distanceHex = sliceHex(hex, cursor, 2);
        const alarmHex = sliceHex(hex, cursor + 4, 1);
        const mm = asUInt16LE(distanceHex);
        result.sensor.distance_mm = mm;
        result.sensor.distance_cm = mm / 10;
        result.sensor.distance_alarm = asUInt8(alarmHex);
        cursor += 6;
        continue;
      }
      case '0500': {
        const positionHex = sliceHex(hex, cursor, 1);
        const pos = asUInt8(positionHex);
        result.sensor.position = pos === 0 ? 'normal' : 'tilt';
        cursor += 2;
        continue;
      }
      default: {
        const knownLengths = {
          ff01: 1,
          ff09: 2,
          ff0a: 2,
          ffff: 2,
          ff0f: 1,
          ff0b: 1,
          fffe: 1,
          fe02: 2,
          fe03: 2,
          fe10: 1,
          fe13: 1,
          fe1c: 2,
          fe28: 1,
          fe3e: 1,
          fe4a: 1,
          fe56: 1,
          fe70: 2,
          fe71: 1,
          fe77: 2,
        };

        const length = knownLengths[key];
        if (length != null) {
          const rawHex = sliceHex(hex, cursor, length);
          result.unknown.push({ channel, type, len: length, rawHex });
          cursor += length * 2;
          continue;
        }

        result.unknown.push({ channel, type, len: 0, rawHex: '' });
        cursor = hex.length;
        break;
      }
    }
  }

  if (result.sensor.temperature_alarm !== undefined) {
    result.sensor.temperature_alarm = Number(result.sensor.temperature_alarm);
  }
  if (result.sensor.distance_alarm !== undefined) {
    result.sensor.distance_alarm = Number(result.sensor.distance_alarm);
  }

  return result;
}

function parseNBIoTUplink(payload) {
  const hex = normalizeInput(payload);
  return parseTLV(hex);
}

function decodeUplink(input) {
  const bytes = Buffer.from(input.bytes || []);
  const data = parseTLV(bytes.toString('hex'));
  return { data };
}

function Decoder(bytes) {
  const data = parseTLV(Buffer.from(bytes || []).toString('hex'));
  return data;
}

function Decode(_fPort, bytes) {
  return Decoder(bytes);
}

function hashPayload(payload) {
  const hex = normalizeInput(payload);
  return crypto.createHash('sha256').update(hex).digest('hex');
}

module.exports = {
  normalizeInput,
  parseTLV,
  parseNBIoTUplink,
  decodeUplink,
  Decoder,
  Decode,
  hashPayload,
};
