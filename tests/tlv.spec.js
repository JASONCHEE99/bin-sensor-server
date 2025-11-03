'use strict';

const {
  parseTLV,
  parseNBIoTUplink,
} = require('../src/parsers/milesight-unified-em400-mud');

describe('milesight EM400 TLV parser', () => {
  test('parses FF/16 (SN)', () => {
    const payload = 'ff160102030405060708';
    const parsed = parseTLV(payload);
    expect(parsed.sn).toBe('0102030405060708');
  });

  test('parses 01/75 (battery)', () => {
    const payload = '017564';
    const parsed = parseTLV(payload);
    expect(parsed.sensor.battery).toBe(100);
  });

  test('parses 03/67 (temperature)', () => {
    const payload = '0367e803';
    const parsed = parseTLV(payload);
    expect(parsed.sensor.temperature_c).toBe(10.0);
  });

  test('parses 04/82 (distance)', () => {
    const payload = '0482d204';
    const parsed = parseTLV(payload);
    expect(parsed.sensor.distance_mm).toBe(1234);
    expect(parsed.sensor.distance_cm).toBeCloseTo(123.4);
  });

  test('parses 83/67 (temperature + alarm)', () => {
    const payload = '8367f40101';
    const parsed = parseTLV(payload);
    expect(parsed.sensor.temperature_c).toBe(5.0);
    expect(parsed.sensor.temperature_alarm).toBe(1);
  });

  test('parses 84/82 (distance + alarm)', () => {
    const payload = '8482580201';
    const parsed = parseTLV(payload);
    expect(parsed.sensor.distance_mm).toBe(600);
    expect(parsed.sensor.distance_cm).toBe(60);
    expect(parsed.sensor.distance_alarm).toBe(1);
  });

  test('parseNBIoTUplink handles base64 input', () => {
    const hex = 'ff160102030405060708017564';
    const base64 = Buffer.from(hex, 'hex').toString('base64');
    const parsed = parseNBIoTUplink(base64);
    expect(parsed.sn).toBe('0102030405060708');
    expect(parsed.sensor.battery).toBe(100);
  });
});
