const {
  parseTLV,
  parseNBIoTUplink,
  hashPayload,
} = require('../src/parsers/milesight-unified-em400-mud');

describe('Milesight EM400-MUD TLV parser', () => {
  test('parses core channels (battery, temperature, distance, position)', () => {
    const hexPayload =
      'ff1601020304050607080175640367fd000482d204050000';
    const parsed = parseTLV(hexPayload);

    expect(parsed.sn).toBe('0102030405060708');
    expect(parsed.sensor.battery).toBe(100);
    expect(parsed.sensor.temperature_c).toBe(25.3);
    expect(parsed.sensor.distance_mm).toBe(1234);
    expect(parsed.sensor.distance_cm).toBeCloseTo(123.4);
    expect(parsed.sensor.position).toBe('normal');
    expect(parsed.sensor.temperature_alarm).toBeUndefined();
    expect(parsed.sensor.distance_alarm).toBeUndefined();
  });

  test('parses alarm variants 83/67 and 84/82', () => {
    const hexPayload =
      'ff16010203040506070883672c01018482580201';
    const parsed = parseTLV(hexPayload);

    expect(parsed.sensor.temperature_c).toBeCloseTo(30.0);
    expect(parsed.sensor.temperature_alarm).toBe(1);
    expect(parsed.sensor.distance_mm).toBe(600);
    expect(parsed.sensor.distance_cm).toBe(60);
    expect(parsed.sensor.distance_alarm).toBe(1);
  });

  test('supports base64 input via NB-IoT parser', () => {
    const base64 = Buffer.from(
      'ff1601020304050607080175640367fd000482d204',
      'hex'
    ).toString('base64');
    const parsed = parseNBIoTUplink(base64);
    expect(parsed.sensor.battery).toBe(100);
    expect(parsed.sensor.temperature_c).toBe(25.3);
    expect(parsed.sensor.distance_mm).toBe(1234);
  });

  test('hashPayload generates deterministic sha256 hash', () => {
    const payload = 'ff160102030405060708';
    const hash1 = hashPayload(payload);
    const hash2 = hashPayload(Buffer.from(payload, 'hex'));
    expect(hash1).toHaveLength(64);
    expect(hash1).toBe(hash2);
  });
});
