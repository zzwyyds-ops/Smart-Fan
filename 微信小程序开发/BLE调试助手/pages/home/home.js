const {
  parseTelemetry,
  parseTelemetryPacket,
  parseSyncCode,
} = require('../../utils/fanLogic');

const app = getApp();

function getModeLabel(modeKey) {
  if (modeKey === 'swing') return '摇头模式';
  if (modeKey === 'follow') return '人物跟随模式';
  return '普通模式';
}

function getDefaultDashboard() {
  return {
    connected: false,
    deviceName: '未连接风扇',
    fanOn: false,
    speedLevel: 1,
    speed: '--',
    temperature: '--',
    humidity: '--',
    currentMode: 'normal',
    currentModeLabel: '普通模式',
    smartMode: false,
    timerDisplay: '未设置',
    timerTargetText: '',
    currentSceneName: '',
  };
}

Page({
  data: {
    dashboard: getDefaultDashboard(),
    fanSpeedClass: 'home-fan-off',
    speedText: '停止',
    speedValueText: '0',
    speedDetailText: '风扇已停止',
    speedPercent: 0,
    sceneText: '手动控制',
    timerText: '未设置',
  },

  onLoad() {
    this.syncDashboard();
  },

  onShow() {
    this.bindDashboardListener();
    this.syncDashboard();
  },

  onHide() {
    this.unbindDashboardListener();
  },

  onUnload() {
    this.unbindDashboardListener();
  },

  syncDashboard() {
    const bleConnection = app.globalData.bleConnection || {};
    const source = app.globalData.fanDashboard || {};
    const dashboard = {
      ...getDefaultDashboard(),
      ...source,
    };
    const connected = Boolean(source.connected || bleConnection.connected);
    const deviceName = connected
      ? source.deviceName || bleConnection.deviceName || '已连接风扇'
      : '未连接风扇';
    const speedLevel = Math.max(1, Math.min(5, Number(dashboard.speedLevel) || 1));
    const fanOn = Boolean(dashboard.fanOn);
    const hasSpeedReading =
      fanOn &&
      dashboard.speed !== undefined &&
      dashboard.speed !== null &&
      dashboard.speed !== '' &&
      dashboard.speed !== '--';

    this.setData({
      dashboard: {
        ...dashboard,
        connected,
        deviceName,
        speedLevel,
        fanOn,
      },
      fanSpeedClass: fanOn ? `home-fan-speed-${speedLevel}` : 'home-fan-off',
      speedText: fanOn ? `${speedLevel}档` : '停止',
      speedValueText: fanOn ? String(hasSpeedReading ? dashboard.speed : speedLevel) : '0',
      speedDetailText: fanOn ? (hasSpeedReading ? 'STM32 实时回传' : '当前控制档位') : '风扇已停止',
      speedPercent: fanOn ? speedLevel * 20 : 0,
      sceneText: dashboard.currentSceneName || (dashboard.smartMode ? '智能模式' : '手动控制'),
      timerText: dashboard.timerTargetText || dashboard.timerDisplay || '未设置',
    });
  },

  bindDashboardListener() {
    if (this._dashboardListenerBound) {
      return;
    }

    this._dashboardListenerBound = true;
    this._bleCharacteristicHandler = (res) => {
      const bytes = Array.from(new Uint8Array(res.value));
      const text = this.bufferToText(res.value);
      const packetParsed = parseTelemetryPacket(bytes);
      const parsed = packetParsed || parseTelemetry(text);
      const current = app.globalData.fanDashboard || {};
      const patch = {};
      const syncPatch = parsed ? parseSyncCode(parsed.syncCode) : null;

      if (parsed && parsed.temperature !== null) patch.temperature = parsed.temperature;
      if (parsed && parsed.humidity !== null) patch.humidity = parsed.humidity;
      if (parsed && parsed.speed !== null) patch.speed = parsed.speed;
      if (syncPatch) {
        Object.assign(patch, syncPatch, {
          currentSceneName: '',
        });
        if (syncPatch.currentMode) {
          patch.currentModeLabel = getModeLabel(syncPatch.currentMode);
        }
      }
      if (!Object.keys(patch).length) {
        return;
      }

      app.globalData.fanDashboard = {
        ...current,
        ...patch,
      };
      this.syncDashboard();
    };
    wx.onBLECharacteristicValueChange(this._bleCharacteristicHandler);
  },

  unbindDashboardListener() {
    if (!this._dashboardListenerBound) {
      return;
    }

    if (this._bleCharacteristicHandler) {
      try {
        wx.offBLECharacteristicValueChange(this._bleCharacteristicHandler);
      } catch (err) {
        // Ignore runtime differences in off* callback signatures.
      }
    }
    this._bleCharacteristicHandler = null;
    this._dashboardListenerBound = false;
  },

  bufferToText(buffer) {
    if (typeof TextDecoder !== 'undefined') {
      try {
        return new TextDecoder('utf-8').decode(buffer).replace(/\0+$/g, '').trim();
      } catch (err) {
        // Fall back to byte-wise decoding below.
      }
    }

    const bytes = new Uint8Array(buffer);
    let text = '';
    for (let i = 0; i < bytes.length; i += 1) {
      text += String.fromCharCode(bytes[i]);
    }
    return text.trim();
  },

  goDebug() {
    wx.navigateTo({
      url: '/pages/index/index',
    });
  },

  goFan() {
    wx.navigateTo({
      url: '/pages/fan/fan',
    });
  },
});
