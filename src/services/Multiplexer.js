/**
 * 多路复用器 - 用于在单个 WebSocket 连接上创建多个虚拟频道
 * 移植自 ws-scrcpy 的 Multiplexer.ts
 * 注意：ws-scrcpy 使用 Little Endian (LE) 字节序
 */

// 消息类型 - 必须与 ws-scrcpy 服务器定义一致
const MessageType = {
  CreateChannel: 4,
  CloseChannel: 8,
  RawBinaryData: 16,
  RawStringData: 32,
  Data: 64
}

// 解析多路复用消息 - 使用 Little Endian
function parseMessage(data) {
  if (!(data instanceof ArrayBuffer)) {
    throw new Error('Expected ArrayBuffer')
  }
  
  const view = new DataView(data)
  const type = view.getUint8(0)
  const channelId = view.getUint32(1, true)  // LE = true
  const payload = data.slice(5)
  
  return { type, channelId, data: payload }
}

// 创建消息缓冲区 - 使用 Little Endian
function createMessageBuffer(type, channelId, payload) {
  const payloadArray = payload instanceof ArrayBuffer 
    ? new Uint8Array(payload) 
    : new Uint8Array(payload.buffer || payload)
  
  const buffer = new ArrayBuffer(5 + payloadArray.length)
  const view = new DataView(buffer)
  const uint8View = new Uint8Array(buffer)
  
  view.setUint8(0, type)
  view.setUint32(1, channelId, true)  // LE = true
  uint8View.set(payloadArray, 5)
  
  return buffer
}

// 创建关闭消息 - 使用 Little Endian
function createCloseBuffer(channelId, code = 1000, reason = '') {
  const reasonBytes = new TextEncoder().encode(reason)
  const buffer = new ArrayBuffer(5 + 2 + 4 + reasonBytes.length)
  const view = new DataView(buffer)
  const uint8View = new Uint8Array(buffer)
  
  view.setUint8(0, MessageType.CloseChannel)
  view.setUint32(1, channelId, true)  // LE = true
  view.setUint16(5, code, true)  // LE = true
  view.setUint32(7, reasonBytes.length, true)  // LE = true
  uint8View.set(reasonBytes, 11)
  
  return buffer
}

/**
 * 虚拟频道类
 */
class Channel {
  constructor(multiplexer, id) {
    this.multiplexer = multiplexer
    this.id = id
    this.readyState = WebSocket.CONNECTING
    this.binaryType = 'arraybuffer'
    
    this.onopen = null
    this.onclose = null
    this.onmessage = null
    this.onerror = null
  }
  
  get CONNECTING() { return WebSocket.CONNECTING }
  get OPEN() { return WebSocket.OPEN }
  get CLOSING() { return WebSocket.CLOSING }
  get CLOSED() { return WebSocket.CLOSED }
  
  send(data) {
    if (this.readyState !== WebSocket.OPEN) {
      throw new Error('Channel is not open')
    }
    
    let buffer
    if (typeof data === 'string') {
      const encoded = new TextEncoder().encode(data)
      buffer = createMessageBuffer(MessageType.RawStringData, this.id, encoded)
    } else {
      buffer = createMessageBuffer(MessageType.RawBinaryData, this.id, data)
    }
    
    this.multiplexer._sendRaw(buffer)
  }
  
  close(code = 1000, reason = '') {
    if (this.readyState === WebSocket.CLOSED || this.readyState === WebSocket.CLOSING) {
      return
    }
    
    this.readyState = WebSocket.CLOSING
    
    const buffer = createCloseBuffer(this.id, code, reason)
    this.multiplexer._sendRaw(buffer)
    
    this.readyState = WebSocket.CLOSED
    this.multiplexer._removeChannel(this.id)
    
    if (this.onclose) {
      this.onclose({ code, reason })
    }
  }
  
  _dispatchOpen() {
    this.readyState = WebSocket.OPEN
    if (this.onopen) {
      this.onopen({})
    }
  }
  
  _dispatchMessage(data) {
    if (this.onmessage) {
      this.onmessage({ data })
    }
  }
  
  _dispatchClose(code, reason) {
    this.readyState = WebSocket.CLOSED
    if (this.onclose) {
      this.onclose({ code, reason })
    }
  }
  
  _dispatchError(error) {
    if (this.onerror) {
      this.onerror({ error })
    }
  }
}

/**
 * 多路复用器类
 */
export class Multiplexer {
  static wrap(ws) {
    return new Multiplexer(ws)
  }
  
  constructor(ws) {
    this.ws = ws
    this.channels = new Map()
    this.nextId = 1
    this.readyState = ws.readyState
    
    ws.binaryType = 'arraybuffer'
    
    ws.addEventListener('open', () => {
      this.readyState = WebSocket.OPEN
    })
    
    ws.addEventListener('close', (event) => {
      this.readyState = WebSocket.CLOSED
      this.channels.forEach(channel => {
        channel._dispatchClose(event.code, event.reason)
      })
      this.channels.clear()
    })
    
    ws.addEventListener('error', (event) => {
      this.channels.forEach(channel => {
        channel._dispatchError(event)
      })
    })
    
    ws.addEventListener('message', (event) => {
      this._handleMessage(event.data)
    })
  }
  
  get CONNECTING() { return WebSocket.CONNECTING }
  get OPEN() { return WebSocket.OPEN }
  get CLOSING() { return WebSocket.CLOSING }
  get CLOSED() { return WebSocket.CLOSED }
  
  _handleMessage(data) {
    try {
      const message = parseMessage(data)
      const channel = this.channels.get(message.channelId)
      
      switch (message.type) {
        case MessageType.CreateChannel:
          break
          
        case MessageType.Data:
        case MessageType.RawBinaryData:
          if (channel) {
            channel._dispatchMessage(message.data)
          }
          break
          
        case MessageType.RawStringData:
          if (channel) {
            const text = new TextDecoder().decode(message.data)
            channel._dispatchMessage(text)
          }
          break
          
        case MessageType.CloseChannel:
          if (channel) {
            const view = new DataView(message.data)
            const code = view.getUint16(0, true)  // LE = true
            const reasonLength = view.getUint32(2, true)  // LE = true
            const reason = new TextDecoder().decode(message.data.slice(6, 6 + reasonLength))
            
            channel._dispatchClose(code, reason)
            this.channels.delete(message.channelId)
          }
          break
      }
    } catch (error) {
      console.error('Failed to handle multiplexer message:', error)
    }
  }
  
  createChannel(initData) {
    const id = this.nextId++
    const channel = new Channel(this, id)
    this.channels.set(id, channel)
    
    const buffer = createMessageBuffer(MessageType.CreateChannel, id, initData)
    this._sendRaw(buffer)
    
    setTimeout(() => {
      if (this.readyState === WebSocket.OPEN) {
        channel._dispatchOpen()
      }
    }, 0)
    
    return channel
  }
  
  _sendRaw(data) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data)
    }
  }
  
  _removeChannel(id) {
    this.channels.delete(id)
  }
  
  close(code = 1000, reason = '') {
    this.channels.forEach(channel => {
      channel.close(code, reason)
    })
    this.ws.close(code, reason)
  }
}
