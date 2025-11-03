#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { parseNBIoTUplink } = require('../src/parsers/milesight-unified-em400-mud');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/replay.js <hex_samples.txt>');
  process.exit(1);
}

const filePath = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
if (!fs.existsSync(filePath)) {
  console.error(`[replay] File not found: ${filePath}`);
  process.exit(1);
}

const lines = fs
  .readFileSync(filePath, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));

if (lines.length === 0) {
  console.log('[replay] No samples found in file');
  process.exit(0);
}

lines.forEach((line, index) => {
  try {
    const parsed = parseNBIoTUplink(line);
    console.log(
      JSON.stringify(
        {
          index,
          input: line,
          sn: parsed.sn || null,
          sensor: parsed.sensor || {},
          unknown: parsed.unknown || [],
        },
        null,
        2
      )
    );
  } catch (err) {
    console.error(
      JSON.stringify(
        {
          index,
          input: line,
          error: err.message,
        },
        null,
        2
      )
    );
  }
});
