// milesight-nb-parser.js

function hexToIntLE(hex) {
  // 2字节：小端转十进制
  if (hex.length === 4) return parseInt(hex.match(/../g).reverse().join(''), 16);
  return parseInt(hex, 16);
}

function parseNBIoTUplink(hex) {
  try {
    // 清理前缀与大小写
    hex = hex.replace(/^0x/, '').toLowerCase();

    // 获取SN字段，协议: 16字节ASCII，从第28位起共32位hex
    const snHex = hex.slice(28, 60);
    let sn = '';
    for (let i = 0; i < snHex.length; i += 2) {
      const ascii = parseInt(snHex.slice(i, i+2), 16);
      if (ascii >= 32 && ascii <= 126) sn += String.fromCharCode(ascii);
    }

    // 查找通道起点，Milesight一般0175为电池通道开头
    let dataStart = hex.search(/0175/i);
    if (dataStart < 0) return { sn, sensor: null };

    let i = dataStart;
    const sensor = {};

    while (i < hex.length) {
      const ch = hex.substr(i, 2);
      const type = hex.substr(i + 2, 2);

      if (ch === '01' && type === '75') {
        // 电池
        let v = hexToIntLE(hex.substr(i + 4, 2));
        sensor.battery = v + ' %';
        i += 6;
      } else if (ch === '03' && type === '67') {
        // 温度
        let t = hexToIntLE(hex.substr(i + 4, 4)) * 0.1;
        sensor.temperature = t + " °C";
        sensor.temperatureAlarm = hex.substr(i + 8, 2) === '01';
        i += 10;
      } else if (ch === '04' && type === '82') {
        // 距离
        let d_mm = hexToIntLE(hex.substr(i + 4, 4));
        let d_cm = (d_mm / 10).toFixed(2); // 保留2位小数
        sensor.distance = d_cm + " cm";
        sensor.distance_raw_mm = d_mm + " mm";
        sensor.distanceAlarm = hex.substr(i + 8, 2) === '01';
        i += 10;
      } else if (ch === '05' && type === '00') {
        // 位置
        const pos = hex.substr(i + 4, 2);
        sensor.position = pos === '00' ? 'normal' : 'tilt';
        i += 6;
      } else {
        // 未知，退出循环
        break;
      }
    }

    return { sn, sensor };
  } catch (e) {
    console.error("NB-IoT hex parse failed:", e.message);
    return null;
  }
}

module.exports = { parseNBIoTUplink };