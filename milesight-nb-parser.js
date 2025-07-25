// milesight-nb-parser.js

function parseNBIoTUplink(hex) {
  try {
    // 确保为小写且无0x前缀
    hex = hex.replace(/^0x/, '').toLowerCase();
    // 按手册结构定位（略去校验部分以适应常用报文，实际报文可根据产商协议修正）
    
    // 找到SN（假设SN为16字节等于32 hex字符，通常SN前有[sw ver(8)][hw ver(8)]共16个hex）
    // 一般 SN 在第14~45 Byte:(28~60 hex) (02 0001 [len] [FLAG] [frame] 01 [SW][HW][SN...])
    const snHex = hex.slice(28, 60);
    let sn = '';
    for (let i = 0; i < snHex.length; i += 2) {
      const ascii = parseInt(snHex.slice(i, i+2), 16);
      if (ascii >= 32 && ascii <= 126) sn += String.fromCharCode(ascii); // 仅可打印字符
    }
    sn = sn.replace(/\0/g, '');

    // 数据部分紧跟在信号强度/各信息之后，需定位Data起始
    // 一般Data类似0175640367f80004820101050000...
    const dataOffset = hex.indexOf('0175');
    if (dataOffset < 0) return null;

    // 解析battery
    const battery = parseInt(hex.slice(dataOffset + 4, dataOffset + 6), 16);

    // 解析temperature (0367) 2字节，后面2字节
    const tempRaw = parseInt(hex.slice(dataOffset + 10, dataOffset + 14), 16);
    let temperature = tempRaw > 0x7fff ? tempRaw - 0x10000 : tempRaw;
    temperature = temperature * 0.1;

    // 解析distance (0482) 2字节，后面2字节
    const distance = parseInt(hex.slice(dataOffset + 18, dataOffset + 22), 16);

    // 解析position (0500) + 00/01
    const positionRaw = hex.slice(dataOffset + 26, dataOffset + 28);
    const position = positionRaw === '00' ? 'normal' : 'tilt';

    return {
      sn,
      sensor: {
        distance, battery, temperature, position
      }
    };
  } catch (e) {
    console.error("NB-IoT hex parse failed:", e.message);
    return null;
  }
}

module.exports = { parseNBIoTUplink };