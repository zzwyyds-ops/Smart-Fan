const MODE_COMMANDS = {
  normal: '02',
  swing: '03',
  follow: '04',
};

const SYNC_CODE_PATCHES = {
  0x00: { fanOn: true, smartMode: false },
  0x01: { fanOn: false, smartMode: false },
  0x02: { currentMode: 'normal', smartMode: false },
  0x03: { currentMode: 'swing', smartMode: false },
  0x04: { currentMode: 'follow', smartMode: false },
  0x05: { fanOn: true, speedLevel: 1, smartMode: false },
  0x06: { fanOn: true, speedLevel: 2, smartMode: false },
  0x07: { fanOn: true, speedLevel: 3, smartMode: false },
  0x08: { fanOn: true, speedLevel: 4, smartMode: false },
  0x09: { fanOn: true, speedLevel: 5, smartMode: false },
};

function commandForPower(isOn) {
  return isOn ? '00' : '01';
}

function commandForMode(mode) {
  return MODE_COMMANDS[mode] || MODE_COMMANDS.normal;
}

function commandForSpeed(level) {
  const safeLevel = Math.min(5, Math.max(1, Number(level) || 1));
  return (safeLevel + 4).toString(16).padStart(2, '0').toUpperCase();
}

function parseTelemetry(text) {
  const source = String(text || '');
  const temperature = findNumber(source, [
    /(?:T|temp|temperature)\s*[:=]\s*(-?\d+(?:\.\d+)?)/i,
    /温度\s*[:=：]\s*(-?\d+(?:\.\d+)?)/,
  ]);
  const humidity = findNumber(source, [
    /(?:H|hum|humidity)\s*[:=]\s*(-?\d+(?:\.\d+)?)/i,
    /湿度\s*[:=：]\s*(-?\d+(?:\.\d+)?)/,
  ]);
  const speed = findNumber(source, [
    /(?:S|speed)\s*[:=]\s*(\d+(?:\.\d+)?)/i,
    /速度\s*[:=：]\s*(\d+(?:\.\d+)?)/,
  ]);

  return {
    temperature,
    humidity,
    speed,
  };
}

function parseTelemetryPacket(input) {
  const bytes = Array.from(input || []);

  if (bytes.length < 5) {
    return null;
  }

  const hasSyncCode = bytes.length >= 6;
  const tailIndex = hasSyncCode ? 5 : 4;
  if (bytes[0] !== 0xff || bytes[tailIndex] !== 0xfe) {
    return null;
  }

  return {
    temperature: bytes[1],
    humidity: bytes[2],
    speed: bytes[3],
    syncCode: hasSyncCode ? bytes[4] : null,
  };
}

function parseSyncCode(syncCode) {
  const normalized = Number(syncCode);
  if (!Number.isInteger(normalized)) {
    return null;
  }

  const patch = SYNC_CODE_PATCHES[normalized];
  if (!patch) {
    return null;
  }

  return {
    syncCode: normalized,
    ...patch,
  };
}

function chooseSmartSpeedLevel({ temperature, humidity }) {
  const temp = Number(temperature);
  const hum = Number(humidity);

  if (temp >= 32 || hum >= 75) return 5;
  if (temp >= 29 || hum >= 65) return 4;
  if (temp >= 26 || hum >= 55) return 3;
  if (temp >= 23 || hum >= 45) return 2;
  return 1;
}

function findNumber(source, patterns) {
  for (let i = 0; i < patterns.length; i += 1) {
    const match = source.match(patterns[i]);
    if (match) {
      return Number(match[1]);
    }
  }

  return null;
}

module.exports = {
  commandForMode,
  commandForPower,
  commandForSpeed,
  parseTelemetry,
  parseTelemetryPacket,
  parseSyncCode,
  chooseSmartSpeedLevel,
};
