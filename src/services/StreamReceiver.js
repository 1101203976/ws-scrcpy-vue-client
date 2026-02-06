/**
 * 流接收器 - 用于接收设备的视频流和处理控制消息
 * 移植自 ws-scrcpy 的 StreamReceiver.ts
 */

// scrcpy 初始消息魔法字节
const MAGIC_BYTES_INITIAL = stringToBytes('scrcpy_initial')
const MAGIC_BYTES_MESSAGE = stringToBytes('scrcpy_message')
const DEVICE_NAME_FIELD_LENGTH = 64

function stringToBytes(str) {
  const bytes = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i)
  }
  return bytes
}

function bytesToString(bytes) {
  let str = ''
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) break
    str += String.fromCharCode(bytes[i])
  }
  return str
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * 简单的事件发射器
 */
class EventEmitter {
  constructor() {
    this.listeners = {}
  }
  
  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = []
    }
    this.listeners[event].push(callback)
  }
  
  off(event, callback) {
    if (!this.listeners[event]) return
    const index = this.listeners[event].indexOf(callback)
    if (index !== -1) {
      this.listeners[event].splice(index, 1)
    }
  }
  
  emit(event, data) {
    if (!this.listeners[event]) return
    this.listeners[event].forEach(callback => callback(data))
  }
}

/**
 * 流接收器类
 */
export class StreamReceiver extends EventEmitter {
  constructor(wsUrl) {
    super()
    this.wsUrl = wsUrl
    this.ws = null
    this.deviceName = ''
    this.clientId = -1
    this.hasInitialInfo = false
    this.displayInfoMap = new Map()
    this.screenInfoMap = new Map()
    this.videoSettingsMap = new Map()
    this.connectionCountMap = new Map()
    this.encoders = []
  }
  
  async connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.wsUrl)
        this.ws.binaryType = 'arraybuffer'
        
        this.ws.onopen = () => {
          console.log('StreamReceiver WebSocket connected')
          this.emit('connected')
          resolve()
        }
        
        this.ws.onclose = (event) => {
          console.log('StreamReceiver WebSocket closed', event.code, event.reason)
          this.emit('disconnected', event)
        }
        
        this.ws.onerror = (error) => {
          console.error('StreamReceiver WebSocket error', error)
          this.emit('error', error)
          reject(error)
        }
        
        this.ws.onmessage = (event) => {
          this.handleMessage(event.data)
        }
      } catch (error) {
        reject(error)
      }
    })
  }
  
  disconnect() {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }
  
  handleMessage(data) {
    
    if (!(data instanceof ArrayBuffer)) {
      return
    }
    
    if (data.byteLength > MAGIC_BYTES_INITIAL.length) {
      const magicBytes = new Uint8Array(data, 0, MAGIC_BYTES_INITIAL.length)
      
      // 检查是否是初始信息
      if (arraysEqual(magicBytes, MAGIC_BYTES_INITIAL)) {
        console.log('Received initial info')
        this.handleInitialInfo(data)
        return
      }
      
      // 检查是否是设备消息
      if (arraysEqual(magicBytes, MAGIC_BYTES_MESSAGE)) {
        console.log('Received device message')
        this.handleDeviceMessage(data)
        return
      }
    }
    
    // 视频数据
    this.emit('video', data)
  }
  
  handleInitialInfo(data) {
    let offset = MAGIC_BYTES_INITIAL.length
    
    // 读取设备名称
    const nameBytes = new Uint8Array(data, offset, DEVICE_NAME_FIELD_LENGTH)
    this.deviceName = bytesToString(nameBytes)
    offset += DEVICE_NAME_FIELD_LENGTH
    
    // 读取显示信息
    const view = new DataView(data, offset)
    const displaysCount = view.getInt32(0, false)
    offset += 4
    
    this.displayInfoMap.clear()
    this.screenInfoMap.clear()
    this.videoSettingsMap.clear()
    this.connectionCountMap.clear()
    
    for (let i = 0; i < displaysCount; i++) {
      // DisplayInfo: 24 bytes
      const displayView = new DataView(data, offset)
      const displayId = displayView.getInt32(0, false)
      const displayWidth = displayView.getInt32(4, false)
      const displayHeight = displayView.getInt32(8, false)
      const rotation = displayView.getInt32(12, false)
      const density = displayView.getInt32(16, false)
      const flags = displayView.getInt32(20, false)
      
      const displayInfo = { displayId, width: displayWidth, height: displayHeight, rotation, density, flags }
      this.displayInfoMap.set(displayId, displayInfo)
      console.log('Display info:', displayInfo)
      offset += 24
      
      // 连接数
      const connView = new DataView(data, offset)
      const connectionCount = connView.getInt32(0, false)
      this.connectionCountMap.set(displayId, connectionCount)
      offset += 4
      
      // ScreenInfo 字节数
      const screenInfoSize = new DataView(data, offset).getInt32(0, false)
      offset += 4
      if (screenInfoSize > 0) {
        offset += screenInfoSize
      }
      
      // VideoSettings 字节数
      const videoSettingsSize = new DataView(data, offset).getInt32(0, false)
      offset += 4
      if (videoSettingsSize > 0) {
        offset += videoSettingsSize
      }
    }
    
    // 编码器列表
    const encodersView = new DataView(data, offset)
    const encodersCount = encodersView.getInt32(0, false)
    offset += 4
    
    this.encoders = []
    for (let i = 0; i < encodersCount; i++) {
      const nameLength = new DataView(data, offset).getInt32(0, false)
      offset += 4
      const encoderName = bytesToString(new Uint8Array(data, offset, nameLength))
      this.encoders.push(encoderName)
      offset += nameLength
    }
    
    // 客户端 ID
    this.clientId = new DataView(data, offset).getInt32(0, false)
    
    this.hasInitialInfo = true
    this.emit('displayInfo', Array.from(this.displayInfoMap.values()))
    this.emit('encoders', this.encoders)
    this.emit('clientsStats', { clientId: this.clientId, deviceName: this.deviceName })
  }
  
  handleDeviceMessage(data) {
    console.log('Device message received')
    this.emit('deviceMessage', data)
  }
  
  sendControlMessage(buffer) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(buffer)
    }
  }
  
  getDeviceName() {
    return this.deviceName
  }
  
  getClientId() {
    return this.clientId
  }
  
  getDisplayInfo(displayId) {
    return this.displayInfoMap.get(displayId)
  }
}
