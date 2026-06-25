const BLE_SERVICE_UUID = '0000FFE0-0000-1000-8000-00805F9B34FB';
const BLE_CHAR_UUID = '0000FFE1-0000-1000-8000-00805F9B34FB';
const app = getApp();

function getDefaultDebugPageState() {
  return {
    receivedData: [],
    sendText: '',
    sendMode: 'text',
    canSend: false,
    hexDisplay: false,
    scrollToId: '',
  };
}

Page({
  data: {
    bleReady: false,
    scanning: false,
    connecting: false,
    connected: false,

    deviceName: '',
    deviceId: '',
    devices: [],

    serviceId: '',
    notifyCharId: '',
    writeCharId: '',
    writeType: 'write',

    receivedData: [],
    sendText: '',
    sendMode: 'text',
    canSend: false,
    hexDisplay: false,

    scrollToId: '',
    _deviceMap: {},
  },

  onLoad() {
    this._restoreDebugPageState();
    this.initBLE();
  },

  onHide() {
    this._saveDebugPageState();
  },

  onUnload() {
    this._saveDebugPageState();
    this.stopScan();
    wx.offBluetoothAdapterStateChange();
    wx.offBLEConnectionStateChange();
    wx.offBLECharacteristicValueChange();
    wx.offBluetoothDeviceFound();
  },

  initBLE() {
    wx.openBluetoothAdapter({
      mode: 'central',
      success: () => {
        this.setData({ bleReady: true });
        this._bindBLEEvents();
        this._restoreGlobalConnection();
      },
      fail: (err) => {
        this.setData({ bleReady: false });
        let msg = '蓝牙初始化失败';
        if (err.errCode === 10001) {
          msg = '请先打开手机蓝牙';
        } else if (err.errCode === 10012) {
          msg = '请授予蓝牙权限';
        }
        wx.showModal({
          title: '提示',
          content: `${msg}，是否重试？`,
          success: (res) => {
            if (res.confirm) this.initBLE();
          },
        });
      },
    });
  },

  _bindBLEEvents() {
    wx.onBluetoothAdapterStateChange((res) => {
      if (!res.available) {
        this.setData({
          bleReady: false,
          connected: false,
          connecting: false,
          scanning: false,
          deviceName: '',
          deviceId: '',
          receivedData: [],
        });
        wx.showToast({ title: '蓝牙已关闭', icon: 'none' });
        return;
      }

      this.setData({ bleReady: true });
    });

    wx.onBLEConnectionStateChange((res) => {
      if (!res.connected) {
        this._clearGlobalConnection();
        this.setData({
          connected: false,
          connecting: false,
        });
        wx.showToast({ title: '设备已断开', icon: 'none' });
      }
    });

    wx.onBLECharacteristicValueChange((res) => {
      const hex = this._ab2hex(res.value);
      const ascii = this._hexToAscii(hex);
      const item = {
        time: this._formatTime(new Date()),
        direction: 'receive',
        label: '<- 接收',
        hex,
        ascii,
      };
      this._appendDataItem(item);
    });

    wx.onBluetoothDeviceFound((res) => {
      const deviceMap = this.data._deviceMap;
      const nextDevices = [...this.data.devices];

      (res.devices || []).forEach((device) => {
        if (!device || !device.deviceId || deviceMap[device.deviceId]) {
          return;
        }

        deviceMap[device.deviceId] = true;
        const rssi = typeof device.RSSI === 'number' ? device.RSSI : -100;
        let rssiLevel = 1;
        if (rssi > -50) rssiLevel = 5;
        else if (rssi > -65) rssiLevel = 4;
        else if (rssi > -80) rssiLevel = 3;
        else if (rssi > -90) rssiLevel = 2;

        nextDevices.push({
          ...device,
          rssiLevel,
        });
      });

      this.setData({
        devices: nextDevices,
        _deviceMap: deviceMap,
      });
    });
  },

  toggleScan() {
    if (this.data.scanning) {
      this.stopScan();
      return;
    }

    this.startScan();
  },

  startScan() {
    if (!this.data.bleReady) {
      wx.showToast({ title: '蓝牙未就绪', icon: 'none' });
      return;
    }

    this.setData({
      scanning: true,
      devices: [],
      _deviceMap: {},
    });

    wx.startBluetoothDevicesDiscovery({
      allowDuplicatesKey: false,
      interval: 0,
      powerLevel: 'high',
      fail: (err) => {
        this.setData({ scanning: false });
        wx.showToast({
          title: `扫描失败: ${err.errCode || ''}`,
          icon: 'none',
        });
      },
    });

    this._scanTimer = setTimeout(() => {
      if (this.data.scanning) {
        this.stopScan();
        wx.showToast({ title: '扫描已自动停止', icon: 'none' });
      }
    }, 10000);
  },

  stopScan() {
    if (this._scanTimer) {
      clearTimeout(this._scanTimer);
      this._scanTimer = null;
    }

    wx.stopBluetoothDevicesDiscovery({
      complete: () => {
        this.setData({ scanning: false });
      },
    });
  },

  connectDevice(e) {
    const device = e.currentTarget.dataset.device;
    if (!device || !device.deviceId) {
      return;
    }

    this.stopScan();
    this.setData({
      connecting: true,
      deviceName: device.name || device.localName || '未知设备',
      deviceId: device.deviceId,
    });
    wx.showLoading({ title: '连接中...' });

    wx.createBLEConnection({
      deviceId: device.deviceId,
      timeout: 10000,
      success: () => {
        this._discoverServices(device.deviceId);
      },
      fail: (err) => {
        wx.hideLoading();
        this.setData({ connecting: false });
        const msg = err.errCode === -1 ? '连接超时，请靠近设备重试' : '连接失败';
        wx.showToast({ title: msg, icon: 'none' });
      },
    });
  },

  _discoverServices(deviceId) {
    wx.getBLEDeviceServices({
      deviceId,
      success: (res) => {
        const services = res.services || [];
        let targetService =
          services.find((item) => item.uuid.toUpperCase() === BLE_SERVICE_UUID) ||
          services.find((item) => item.uuid.toUpperCase().includes('FFE0')) ||
          services[0];

        if (!targetService) {
          wx.hideLoading();
          this.setData({ connecting: false });
          wx.showToast({ title: '未找到可用服务', icon: 'none' });
          return;
        }

        this._discoverCharacteristics(deviceId, targetService.uuid);
      },
      fail: () => {
        wx.hideLoading();
        this.setData({ connecting: false });
        wx.showToast({ title: '获取服务失败', icon: 'none' });
      },
    });
  },

  _discoverCharacteristics(deviceId, serviceId) {
    wx.getBLEDeviceCharacteristics({
      deviceId,
      serviceId,
      success: (res) => {
        const characteristics = res.characteristics || [];

        const notifyChar =
          characteristics.find(
            (item) =>
              item.uuid.toUpperCase() === BLE_CHAR_UUID &&
              (item.properties.notify || item.properties.indicate)
          ) ||
          characteristics.find(
            (item) => item.properties.notify || item.properties.indicate
          ) ||
          null;

        const writeChar =
          characteristics.find(
            (item) =>
              item.uuid.toUpperCase() === BLE_CHAR_UUID &&
              (item.properties.write ||
                item.properties.writeNoResponse ||
                item.properties.writeDefault)
          ) ||
          characteristics.find(
            (item) =>
              item.properties.write ||
              item.properties.writeNoResponse ||
              item.properties.writeDefault
          ) ||
          null;

        console.log(
          'characteristics:',
          characteristics.map((item) => ({
            uuid: item.uuid,
            properties: item.properties,
          }))
        );

        if (!notifyChar && !writeChar) {
          wx.hideLoading();
          this.setData({ connecting: false });
          wx.showToast({ title: '未找到可用特征值', icon: 'none' });
          return;
        }

        this._enableNotify(deviceId, serviceId, notifyChar, writeChar);
      },
      fail: () => {
        wx.hideLoading();
        this.setData({ connecting: false });
        wx.showToast({ title: '获取特征值失败', icon: 'none' });
      },
    });
  },

  _enableNotify(deviceId, serviceId, notifyChar, writeChar) {
    const notifyCharId = notifyChar ? notifyChar.uuid : '';
    const writeCharId = writeChar ? writeChar.uuid : notifyCharId;
    const writeType =
      writeChar &&
      writeChar.properties &&
      writeChar.properties.writeNoResponse &&
      !writeChar.properties.write
        ? 'writeNoResponse'
        : 'write';

    if (notifyCharId) {
      wx.notifyBLECharacteristicValueChange({
        deviceId,
        serviceId,
        characteristicId: notifyCharId,
        state: true,
        success: () => {
          this._onConnected(deviceId, serviceId, notifyCharId, writeCharId, writeType);
        },
        fail: () => {
          this._onConnected(deviceId, serviceId, notifyCharId, writeCharId, writeType);
        },
      });
      return;
    }

    this._onConnected(deviceId, serviceId, notifyCharId, writeCharId, writeType);
  },

  _onConnected(deviceId, serviceId, notifyCharId, writeCharId, writeType) {
    wx.hideLoading();
    this._saveGlobalConnection({
      connected: true,
      deviceName: this.data.deviceName,
      deviceId,
      serviceId,
      notifyCharId: notifyCharId || '',
      writeCharId: writeCharId || '',
      writeType: writeType || 'write',
    });
    this.setData({
      connected: true,
      connecting: false,
      serviceId,
      notifyCharId: notifyCharId || '',
      writeCharId: writeCharId || '',
      writeType: writeType || 'write',
    }, () => {
      this._appendDataItem({
        time: this._formatTime(new Date()),
        direction: 'system',
        label: '系统',
        hex: `已连接 write=${this._shortUuid(writeCharId)} notify=${this._shortUuid(notifyCharId)}`,
        ascii: '',
      });
    });
    wx.showToast({ title: '连接成功', icon: 'success', duration: 1500 });
  },

  disconnect() {
    wx.showLoading({ title: '断开中...' });
    wx.closeBLEConnection({
      deviceId: this.data.deviceId,
      complete: () => {
        wx.hideLoading();
        this._clearGlobalConnection();
        this._resetState();
      },
    });
  },

  closeBLEConnection() {
    if (this.data.deviceId && this.data.connected) {
      wx.closeBLEConnection({ deviceId: this.data.deviceId });
    }
    this._clearGlobalConnection();
    this._resetState();
  },

  _restoreGlobalConnection() {
    const saved = app.globalData.bleConnection || {};
    if (!saved.connected || !saved.deviceId || !saved.serviceId || !saved.writeCharId) {
      return;
    }

    this.setData({
      connected: true,
      connecting: false,
      deviceName: saved.deviceName || '已连接设备',
      deviceId: saved.deviceId,
      serviceId: saved.serviceId,
      notifyCharId: saved.notifyCharId || '',
      writeCharId: saved.writeCharId || '',
      writeType: saved.writeType || 'write',
    }, () => {
      const hasRestoreMessage = (this.data.receivedData || []).some(
        (item) =>
          item &&
          item.direction === 'system' &&
          String(item.hex || '').includes('复用连接')
      );
      if (!hasRestoreMessage) {
        this._appendDataItem({
          time: this._formatTime(new Date()),
          direction: 'system',
          label: '系统',
          hex: `复用连接 write=${this._shortUuid(saved.writeCharId)} notify=${this._shortUuid(saved.notifyCharId)}`,
          ascii: '',
        });
      }
    });
  },

  _saveGlobalConnection(connection) {
    app.globalData.bleConnection = {
      ...app.globalData.bleConnection,
      ...connection,
    };
  },

  _clearGlobalConnection() {
    app.globalData.bleConnection = {
      connected: false,
      deviceName: '',
      deviceId: '',
      serviceId: '',
      notifyCharId: '',
      writeCharId: '',
      writeType: 'write',
    };
  },

  _resetState() {
    this.setData({
      connected: false,
      connecting: false,
      serviceId: '',
      notifyCharId: '',
      writeCharId: '',
      writeType: 'write',
      deviceName: '',
      deviceId: '',
      receivedData: [],
      sendText: '',
      sendMode: 'text',
      canSend: false,
      devices: [],
      _deviceMap: {},
      scrollToId: '',
    }, () => {
      this._saveDebugPageState();
    });
  },

  sendData() {
    const text = this.data.sendText;
    if (!text || !text.trim()) {
      return;
    }

    if (!this.data.connected) {
      wx.showToast({ title: '未连接设备', icon: 'none' });
      return;
    }

    if (!this.data.writeCharId) {
      wx.showToast({ title: '设备不支持写入', icon: 'none' });
      return;
    }

    let buffer;
    try {
      buffer = this.data.sendMode === 'hex' ? this._hexInputToBuffer(text) : this._str2ab(text);
    } catch (err) {
      this._appendDataItem({
        time: this._formatTime(new Date()),
        direction: 'system',
        label: '发送异常',
        hex: err.message || String(err),
        ascii: '',
      });
      return;
    }

    const hex = this._ab2hex(buffer);
    const time = this._formatTime(new Date());

    this._appendDataItem({
      time,
      direction: 'system',
      label: `开始发送(${this.data.sendMode === 'hex' ? 'HEX' : '文本'})`,
      hex: `${hex} write=${this._shortUuid(this.data.writeCharId)} type=${this.data.writeType}`,
      ascii: '',
    });

    this._writeBufferInChunks(buffer, {
      success: () => {
        const item = {
          time: this._formatTime(new Date()),
          direction: 'send',
          label: '-> 发送成功',
          raw: hex,
          ascii: '',
        };
        this._appendDataItem(item);
      },
      fail: (err) => {
        console.error('write failed:', err);
        this._appendDataItem({
          time: this._formatTime(new Date()),
          direction: 'system',
          label: '发送失败',
          hex: `errCode=${err.errCode || ''}`,
          ascii: err.errMsg || '',
        });
        wx.showToast({ title: '发送失败', icon: 'none' });
      },
    });
  },

  onSendInput(e) {
    const sendText = e.detail.value || '';
    this.setData({
      sendText,
      canSend: sendText.trim().length > 0,
    }, () => {
      this._saveDebugPageState();
    });
  },

  toggleSendMode() {
    const sendMode = this.data.sendMode === 'hex' ? 'text' : 'hex';
    this.setData({
      sendMode,
      sendText: '',
      canSend: false,
    }, () => {
      this._saveDebugPageState();
    });
  },

  toggleHexDisplay() {
    this.setData({ hexDisplay: !this.data.hexDisplay }, () => {
      this._saveDebugPageState();
    });
  },

  clearData() {
    this.setData({ receivedData: [], scrollToId: '' }, () => {
      this._saveDebugPageState();
    });
  },

  _appendDataItem(item) {
    const receivedData = [...this.data.receivedData, item];
    this.setData({
      receivedData,
      scrollToId: `data-${receivedData.length - 1}`,
    }, () => {
      this._saveDebugPageState();
    });
  },

  _restoreDebugPageState() {
    const saved = {
      ...getDefaultDebugPageState(),
      ...(app.globalData.debugPageState || {}),
    };
    this.setData({
      receivedData: Array.isArray(saved.receivedData) ? saved.receivedData.slice(-120) : [],
      sendText: saved.sendText || '',
      sendMode: saved.sendMode === 'hex' ? 'hex' : 'text',
      canSend: saved.canSend !== undefined ? saved.canSend : Boolean((saved.sendText || '').trim()),
      hexDisplay: Boolean(saved.hexDisplay),
      scrollToId: saved.scrollToId || '',
    });
  },

  _saveDebugPageState() {
    app.globalData.debugPageState = {
      receivedData: Array.isArray(this.data.receivedData) ? this.data.receivedData.slice(-120) : [],
      sendText: this.data.sendText,
      sendMode: this.data.sendMode,
      canSend: this.data.canSend,
      hexDisplay: this.data.hexDisplay,
      scrollToId: this.data.scrollToId,
    };
  },

  _ab2hex(buffer) {
    if (!buffer) {
      return '';
    }

    return Array.from(new Uint8Array(buffer))
      .map((item) => item.toString(16).padStart(2, '0').toUpperCase())
      .join(' ');
  },

  _hexToAscii(hexStr) {
    if (!hexStr) {
      return '';
    }

    return hexStr
      .split(' ')
      .map((item) => {
        const code = parseInt(item, 16);
        return code >= 0x20 && code <= 0x7e ? String.fromCharCode(code) : '.';
      })
      .join('');
  },

  _str2ab(str) {
    const bytes = [];

    for (let i = 0; i < str.length; i += 1) {
      let codePoint = str.charCodeAt(i);

      if (codePoint >= 0xd800 && codePoint <= 0xdbff && i + 1 < str.length) {
        const next = str.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
          i += 1;
        }
      }

      if (codePoint <= 0x7f) {
        bytes.push(codePoint);
      } else if (codePoint <= 0x7ff) {
        bytes.push(0xc0 | (codePoint >> 6));
        bytes.push(0x80 | (codePoint & 0x3f));
      } else if (codePoint <= 0xffff) {
        bytes.push(0xe0 | (codePoint >> 12));
        bytes.push(0x80 | ((codePoint >> 6) & 0x3f));
        bytes.push(0x80 | (codePoint & 0x3f));
      } else {
        bytes.push(0xf0 | (codePoint >> 18));
        bytes.push(0x80 | ((codePoint >> 12) & 0x3f));
        bytes.push(0x80 | ((codePoint >> 6) & 0x3f));
        bytes.push(0x80 | (codePoint & 0x3f));
      }
    }

    return new Uint8Array(bytes).buffer;
  },

  _hexInputToBuffer(input) {
    const compact = input.replace(/0x/gi, '').replace(/[^0-9a-fA-F]/g, '');

    if (!compact) {
      throw new Error('请输入HEX字节');
    }

    if (compact.length % 2 !== 0) {
      throw new Error('HEX长度必须是偶数');
    }

    const bytes = [];
    for (let i = 0; i < compact.length; i += 2) {
      bytes.push(parseInt(compact.slice(i, i + 2), 16));
    }

    return new Uint8Array(bytes).buffer;
  },

  _writeBufferInChunks(buffer, callbacks = {}) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 20;
    const chunks = [];

    for (let i = 0; i < bytes.length; i += chunkSize) {
      chunks.push(bytes.slice(i, i + chunkSize));
    }

    const writeNext = (index) => {
      if (index >= chunks.length) {
        if (callbacks.success) {
          callbacks.success();
        }
        return;
      }

      const chunk = chunks[index];
      this._writeChunk(chunk, this.data.writeType, {
        success: () => {
          setTimeout(() => writeNext(index + 1), 30);
        },
        fail: (err) => {
          const fallbackType = this.data.writeType === 'write' ? 'writeNoResponse' : 'write';
          this._writeChunk(chunk, fallbackType, {
            success: () => {
              this.setData({ writeType: fallbackType });
              setTimeout(() => writeNext(index + 1), 30);
            },
            fail: () => {
              if (callbacks.fail) {
                callbacks.fail(err);
              }
            },
          });
        },
      });
    };

    writeNext(0);
  },

  _writeChunk(chunk, writeType, callbacks) {
    wx.writeBLECharacteristicValue({
        deviceId: this.data.deviceId,
        serviceId: this.data.serviceId,
        characteristicId: this.data.writeCharId,
        value: chunk.buffer,
      writeType,
      success: callbacks.success,
      fail: callbacks.fail,
    });
  },

  _shortUuid(uuid) {
    if (!uuid) {
      return 'none';
    }
    return uuid.slice(4, 8).toUpperCase();
  },

  _formatTime(date) {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
  },
});
