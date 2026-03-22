/**
 * 触控处理器 - 处理鼠标和触摸事件，转换为 scrcpy 控制消息
 * 移植自 ws-scrcpy 的 InteractionHandler.ts
 */

// 控制消息类型
const ControlMessageType = {
  TYPE_KEYCODE: 0,
  TYPE_TEXT: 1,
  TYPE_TOUCH: 2,
  TYPE_SCROLL: 3,
  TYPE_BACK_OR_SCREEN_ON: 4,
  TYPE_EXPAND_NOTIFICATION_PANEL: 5,
  TYPE_EXPAND_SETTINGS_PANEL: 6,
  TYPE_COLLAPSE_PANELS: 7,
  TYPE_GET_CLIPBOARD: 8,
  TYPE_SET_CLIPBOARD: 9,
  TYPE_SET_SCREEN_POWER_MODE: 10,
  TYPE_ROTATE_DEVICE: 11
}

// 动作类型
const MotionEvent = {
  ACTION_DOWN: 0,
  ACTION_UP: 1,
  ACTION_MOVE: 2,
  BUTTON_PRIMARY: 1
}

// 触控消息长度
const TOUCH_PAYLOAD_LENGTH = 28

// 节流间隔 (ms) - 限制移动事件发送频率
const THROTTLE_INTERVAL = 16

/**
 * 创建触控消息的二进制数据
 */
function createTouchMessage(action, pointerId, x, y, screenWidth, screenHeight, pressure = 1.0, buttons = 1) {
  const buffer = new ArrayBuffer(TOUCH_PAYLOAD_LENGTH + 1)
  const view = new DataView(buffer)

  let offset = 0

  view.setUint8(offset, ControlMessageType.TYPE_TOUCH)
  offset += 1

  view.setUint8(offset, action)
  offset += 1

  view.setUint32(offset, 0, false)
  offset += 4
  view.setUint32(offset, pointerId, false)
  offset += 4

  view.setUint32(offset, Math.round(x), false)
  offset += 4

  view.setUint32(offset, Math.round(y), false)
  offset += 4

  view.setUint16(offset, screenWidth, false)
  offset += 2

  view.setUint16(offset, screenHeight, false)
  offset += 2

  const pressureValue = Math.round(pressure * 0xffff)
  view.setUint16(offset, pressureValue)
  offset += 2

  view.setUint32(offset, buttons, false)

  return buffer
}

/**
 * 创建滚动消息的二进制数据
 */
function createScrollMessage(x, y, screenWidth, screenHeight, hScroll, vScroll) {
  const buffer = new ArrayBuffer(21)
  const view = new DataView(buffer)

  let offset = 0

  view.setUint8(offset, ControlMessageType.TYPE_SCROLL)
  offset += 1

  view.setUint32(offset, Math.round(x), false)
  offset += 4

  view.setUint32(offset, Math.round(y), false)
  offset += 4

  view.setUint16(offset, screenWidth, false)
  offset += 2

  view.setUint16(offset, screenHeight, false)
  offset += 2

  view.setInt32(offset, hScroll, false)
  offset += 4

  view.setInt32(offset, vScroll, false)

  return buffer
}

/**
 * 触控处理器类
 */
export class TouchHandler {
  constructor(canvas, sendMessage) {
    this.canvas = canvas
    this.sendMessage = sendMessage
    this.mouseDown = false
    this.lastPosition = null
    this.touchMap = new Map()

    this.pendingMouseMove = null
    this.lastMouseMoveTime = 0

    this.pendingTouchMoves = new Map()
    this.lastTouchMoveTimes = new Map()
    this.throttleRafId = null
  }

  /**
   * 获取画布内的坐标，并转换为屏幕坐标
   */
  getPosition(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect()
    const canvas = this.canvas

    const relativeX = clientX - rect.left
    const relativeY = clientY - rect.top

    const clampedX = Math.max(0, Math.min(relativeX, rect.width))
    const clampedY = Math.max(0, Math.min(relativeY, rect.height))

    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height

    const x = clampedX * scaleX
    const y = clampedY * scaleY

    return {
      x: Math.max(0, Math.min(x, canvas.width)),
      y: Math.max(0, Math.min(y, canvas.height)),
      screenWidth: canvas.width,
      screenHeight: canvas.height
    }
  }

  /**
   * 处理鼠标事件
   */
  handleMouseEvent(event, type) {
    const pos = this.getPosition(event.clientX, event.clientY)

    if (pos.screenWidth === 0 || pos.screenHeight === 0) {
      return
    }

    let action
    let pressure = 1.0

    switch (type) {
      case 'down':
        if (this.mouseDown) return
        this.mouseDown = true
        action = MotionEvent.ACTION_DOWN
        break

      case 'move':
        if (!this.mouseDown) return
        action = MotionEvent.ACTION_MOVE
        break

      case 'up':
        if (!this.mouseDown) return
        this.mouseDown = false
        action = MotionEvent.ACTION_UP
        pressure = 0
        break

      default:
        return
    }

    this.lastPosition = pos

    if (type === 'move') {
      this.pendingMouseMove = {
        pos,
        action,
        pressure
      }
      this.scheduleFlush()
      return
    }

    const buffer = createTouchMessage(
      action,
      0,
      pos.x,
      pos.y,
      pos.screenWidth,
      pos.screenHeight,
      pressure,
      MotionEvent.BUTTON_PRIMARY
    )

    this.sendMessage(buffer)
  }

  /**
   * 处理触摸事件
   */
  handleTouchEvent(event, type) {
    const touches = event.changedTouches

    for (let i = 0; i < touches.length; i++) {
      const touch = touches[i]
      const pos = this.getPosition(touch.clientX, touch.clientY)

      if (pos.screenWidth === 0 || pos.screenHeight === 0) {
        continue
      }

      let action
      let pressure = touch.force || 1.0

      switch (type) {
        case 'start':
          action = MotionEvent.ACTION_DOWN
          this.touchMap.set(touch.identifier, pos)
          this.lastTouchMoveTimes.set(touch.identifier, 0)
          break

        case 'move':
          if (!this.touchMap.has(touch.identifier)) continue
          action = MotionEvent.ACTION_MOVE
          this.touchMap.set(touch.identifier, pos)
          this.pendingTouchMoves.set(touch.identifier, {
            pos,
            pressure
          })
          this.scheduleFlush()
          continue

        case 'end':
          if (!this.touchMap.has(touch.identifier)) continue
          action = MotionEvent.ACTION_UP
          pressure = 0
          this.touchMap.delete(touch.identifier)
          this.pendingTouchMoves.delete(touch.identifier)
          this.lastTouchMoveTimes.delete(touch.identifier)
          break

        default:
          continue
      }

      const buffer = createTouchMessage(
        action,
        touch.identifier,
        pos.x,
        pos.y,
        pos.screenWidth,
        pos.screenHeight,
        pressure,
        MotionEvent.BUTTON_PRIMARY
      )

      this.sendMessage(buffer)
    }
  }

  scheduleFlush() {
    if (this.throttleRafId !== null) return

    this.throttleRafId = requestAnimationFrame(() => {
      this.throttleRafId = null
      this.flushPending()
    })
  }

  flushPending() {
    const now = performance.now()

    if (this.pendingMouseMove) {
      const elapsed = now - this.lastMouseMoveTime
      if (elapsed >= THROTTLE_INTERVAL) {
        const { pos, action, pressure } = this.pendingMouseMove
        const buffer = createTouchMessage(
          action,
          0,
          pos.x,
          pos.y,
          pos.screenWidth,
          pos.screenHeight,
          pressure,
          MotionEvent.BUTTON_PRIMARY
        )
        this.sendMessage(buffer)
        this.lastMouseMoveTime = now
      } else {
        this.scheduleFlush()
      }
      this.pendingMouseMove = null
    }

    if (this.pendingTouchMoves.size > 0) {
      for (const [id, data] of this.pendingTouchMoves) {
        const lastTime = this.lastTouchMoveTimes.get(id) || 0
        const elapsed = now - lastTime

        if (elapsed >= THROTTLE_INTERVAL) {
          const buffer = createTouchMessage(
            MotionEvent.ACTION_MOVE,
            id,
            data.pos.x,
            data.pos.y,
            data.pos.screenWidth,
            data.pos.screenHeight,
            data.pressure,
            MotionEvent.BUTTON_PRIMARY
          )
          this.sendMessage(buffer)
          this.lastTouchMoveTimes.set(id, now)
        } else {
          this.scheduleFlush()
        }
      }
      this.pendingTouchMoves.clear()
    }
  }

  /**
   * 处理滚轮事件
   */
  handleWheelEvent(event) {
    const pos = this.getPosition(event.clientX, event.clientY)

    if (pos.screenWidth === 0 || pos.screenHeight === 0) {
      return
    }

    const hScroll = event.deltaX > 0 ? -1 : event.deltaX < 0 ? 1 : 0
    const vScroll = event.deltaY > 0 ? -1 : event.deltaY < 0 ? 1 : 0

    if (hScroll === 0 && vScroll === 0) {
      return
    }

    const buffer = createScrollMessage(
      pos.x,
      pos.y,
      pos.screenWidth,
      pos.screenHeight,
      hScroll,
      vScroll
    )

    this.sendMessage(buffer)
  }

  /**
   * 销毁处理器
   */
  destroy() {
    if (this.throttleRafId !== null) {
      cancelAnimationFrame(this.throttleRafId)
      this.throttleRafId = null
    }

    this.touchMap.forEach((pos, id) => {
      const buffer = createTouchMessage(
        MotionEvent.ACTION_UP,
        id,
        pos.x,
        pos.y,
        pos.screenWidth,
        pos.screenHeight,
        0,
        MotionEvent.BUTTON_PRIMARY
      )
      this.sendMessage(buffer)
    })

    this.touchMap.clear()
    this.pendingTouchMoves.clear()
    this.lastTouchMoveTimes.clear()
    this.mouseDown = false
  }
}