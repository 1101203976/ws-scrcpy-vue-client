<template>
  <div class="stream-inline">
    <div class="video-wrapper" ref="videoWrapper">
      <canvas
        ref="canvas"
        class="video-canvas"
        @mousedown="handleMouseDown"
        @mousemove="handleMouseMove"
        @mouseup="handleMouseUp"
        @mouseleave="handleMouseLeave"
        @wheel="handleWheel"
        @touchstart.prevent="handleTouchStart"
        @touchmove.prevent="handleTouchMove"
        @touchend.prevent="handleTouchEnd"
        @touchcancel.prevent="handleTouchEnd"
        @contextmenu.prevent
      ></canvas>
      <div v-if="!streamConnected" class="loading-overlay">
        <div class="loading-spinner"></div>
        <span>{{ statusText }}</span>
      </div>
    </div>
  </div>
</template>

<script>
import { StreamReceiver } from "../services/StreamReceiver";
import { TouchHandler } from "../services/TouchHandler";

export default {
  name: "DeviceStream",
  props: {
    device: {
      type: Object,
      required: true,
    },
    wsUrl: {
      type: String,
      required: true,
    },
  },
  data() {
    return {
      streamReceiver: null,
      touchHandler: null,
      streamConnected: false,
      statusText: "正在连接...",
      decoder: null,
      context: null,
      screenWidth: 0,
      screenHeight: 0,
      frameBuffer: null,
      bufferedSPS: false,
      bufferedPPS: false,
      hadIDR: false,
      videoSettingsSent: false,
      currentPts: 0,
    };
  },
  mounted() {
    this.initCanvas();
    this.connect();
  },
  beforeDestroy() {
    this.disconnect();
  },
  methods: {
    initCanvas() {
      const canvas = this.$refs.canvas;
      if (canvas) this.context = canvas.getContext("2d");
    },

    async connect() {
      try {
        this.statusText = "正在连接...";
        this.initDecoder();
        this.streamReceiver = new StreamReceiver(this.wsUrl);

        this.streamReceiver.on("connected", () => {
          this.streamConnected = true;
          this.statusText = "已连接";
        });

        this.streamReceiver.on("video", (data) => {
          this.handleVideoFrame(data);
        });

        this.streamReceiver.on("displayInfo", (info) => {
          if (info && info.length > 0 && !this.videoSettingsSent) {
            this.videoSettingsSent = true;
            this.sendVideoSettings(info[0]);
          }
        });

        this.streamReceiver.on("disconnected", () => {
          this.streamConnected = false;
          this.statusText = "连接已断开";
        });

        this.streamReceiver.on("error", () => {
          this.statusText = "连接出错";
        });

        await this.streamReceiver.connect();

        this.touchHandler = new TouchHandler(this.$refs.canvas, (message) =>
          this.streamReceiver.sendControlMessage(message)
        );
      } catch (error) {
        this.statusText = "连接失败";
      }
    },

    disconnect() {
      if (this.streamReceiver) {
        this.streamReceiver.disconnect();
        this.streamReceiver = null;
      }
      if (this.decoder && this.decoder.state !== "closed") {
        this.decoder.close();
        this.decoder = null;
      }
      if (this.touchHandler) {
        this.touchHandler.destroy();
        this.touchHandler = null;
      }
    },

    initDecoder() {
      if (typeof VideoDecoder === "undefined") {
        this.statusText = "浏览器不支持 WebCodecs";
        return;
      }
      this.decoder = new VideoDecoder({
        output: (frame) => {
          this.drawFrame(frame);
          frame.close();
        },
        error: () => {},
      });
    },

    handleVideoFrame(data) {
      if (!this.decoder || this.decoder.state === "closed") return;
      const array = new Uint8Array(data);
      if (array.length === 12) {
        const view = new DataView(data);
        this.currentPts = Number(view.getBigInt64(0, false));
        return;
      }
      if (array.length < 5) return;
      if (array[0] !== 0 || array[1] !== 0 || array[2] !== 0 || array[3] !== 1) return;
      const nalType = array[4] & 0x1f;
      const isIDR = nalType === 5;

      if (nalType === 7) {
        const config = this.parseSPS(array.subarray(4));
        if (config) {
          this.screenWidth = config.width;
          this.screenHeight = config.height;
          this.updateCanvasSize(config.width, config.height);
          try {
            this.decoder.configure({ codec: config.codec, optimizeForLatency: true });
          } catch (e) {}
        }
        this.bufferedSPS = true;
        this.addToBuffer(array);
        this.hadIDR = false;
        return;
      }
      if (nalType === 8) {
        this.bufferedPPS = true;
        this.addToBuffer(array);
        return;
      }
      if (nalType === 6) {
        if (this.bufferedSPS && this.bufferedPPS) this.addToBuffer(array);
        return;
      }
      if (isIDR) {
        const combinedArray = this.addToBuffer(array);
        this.hadIDR = true;
        if (this.decoder.state === "configured" && combinedArray) {
          try {
            this.decoder.decode(
              new EncodedVideoChunk({
                type: "key",
                timestamp: this.currentPts || 0,
                data: combinedArray.buffer,
              })
            );
          } catch (e) {}
          this.frameBuffer = null;
          this.bufferedPPS = false;
          this.bufferedSPS = false;
        }
        return;
      }
      if (nalType === 1 && this.hadIDR && this.decoder.state === "configured") {
        try {
          this.decoder.decode(
            new EncodedVideoChunk({
              type: "delta",
              timestamp: this.currentPts || 0,
              data: array.buffer,
            })
          );
        } catch (e) {}
      }
    },

    addToBuffer(data) {
      let array;
      if (this.frameBuffer) {
        array = new Uint8Array(this.frameBuffer.byteLength + data.byteLength);
        array.set(new Uint8Array(this.frameBuffer));
        array.set(new Uint8Array(data), this.frameBuffer.byteLength);
      } else {
        array = data;
      }
      this.frameBuffer = array.buffer;
      return array;
    },

    sendVideoSettings(displayInfo) {
      const TYPE_CHANGE_STREAM_PARAMETERS = 101;
      const bufferLength = 1 + 35;
      const buffer = new ArrayBuffer(bufferLength);
      const view = new DataView(buffer);
      let offset = 0;
      view.setUint8(offset, TYPE_CHANGE_STREAM_PARAMETERS);
      offset += 1;
      view.setInt32(offset, 524288, false);
      offset += 4;
      view.setInt32(offset, 24, false);
      offset += 4;
      view.setInt8(offset, 5);
      offset += 1;
      view.setInt16(offset, 1280, false);
      offset += 2;
      view.setInt16(offset, 1280, false);
      offset += 2;
      for (let i = 0; i < 4; i++) {
        view.setInt16(offset, 0, false);
        offset += 2;
      }
      view.setInt8(offset, 1);
      offset += 1;
      view.setInt8(offset, -1);
      offset += 1;
      view.setInt32(offset, displayInfo?.displayId || 0, false);
      offset += 4;
      view.setInt32(offset, 0, false);
      offset += 4;
      view.setInt32(offset, 0, false);
      this.streamReceiver.sendControlMessage(buffer);
    },

    parseSPS(data) {
      try {
        const profileIdc = data[1];
        const constraintFlags = data[2];
        const levelIdc = data[3];
        const toHex = (v) => v.toString(16).padStart(2, "0").toUpperCase();
        const codec = `avc1.${toHex(profileIdc)}${toHex(constraintFlags)}${toHex(levelIdc)}`;
        return { codec, width: 1080, height: 1920 };
      } catch (e) {
        return null;
      }
    },

    updateCanvasSize(width, height) {
      const canvas = this.$refs.canvas;
      const wrapper = this.$refs.videoWrapper;
      if (!canvas || !wrapper) return;
      canvas.width = width;
      canvas.height = height;
      const wrapperRect = wrapper.getBoundingClientRect();
      const scaleX = wrapperRect.width / width;
      const scaleY = wrapperRect.height / height;
      const scale = Math.min(scaleX, scaleY, 1);
      canvas.style.width = `${width * scale}px`;
      canvas.style.height = `${height * scale}px`;
    },

    drawFrame(frame) {
      if (!this.context) return;
      const canvas = this.$refs.canvas;
      if (
        canvas.width !== frame.displayWidth ||
        canvas.height !== frame.displayHeight
      ) {
        this.updateCanvasSize(frame.displayWidth, frame.displayHeight);
        canvas.width = frame.displayWidth;
        canvas.height = frame.displayHeight;
      }
      this.context.drawImage(frame, 0, 0);
    },

    handleMouseDown(e) {
      if (this.touchHandler) this.touchHandler.handleMouseEvent(e, "down");
    },
    handleMouseMove(e) {
      if (this.touchHandler) this.touchHandler.handleMouseEvent(e, "move");
    },
    handleMouseUp(e) {
      if (this.touchHandler) this.touchHandler.handleMouseEvent(e, "up");
    },
    handleMouseLeave(e) {
      if (this.touchHandler) this.touchHandler.handleMouseEvent(e, "up");
    },
    handleWheel(e) {
      if (this.touchHandler) this.touchHandler.handleWheelEvent(e);
    },
    handleTouchStart(e) {
      if (this.touchHandler) this.touchHandler.handleTouchEvent(e, "start");
    },
    handleTouchMove(e) {
      if (this.touchHandler) this.touchHandler.handleTouchEvent(e, "move");
    },
    handleTouchEnd(e) {
      if (this.touchHandler) this.touchHandler.handleTouchEvent(e, "end");
    },
    
    sendKey(keycode) {
      if (!this.streamReceiver) return;
      
      const ACTION_DOWN = 0;
      const ACTION_UP = 1;
      const TYPE_KEYCODE = 0;
      const PAYLOAD_LENGTH = 13;
      
      const createMsg = (action) => {
        const buffer = new ArrayBuffer(PAYLOAD_LENGTH + 1);
        const view = new DataView(buffer);
        view.setUint8(0, TYPE_KEYCODE);
        view.setUint8(1, action);
        view.setUint32(2, keycode, false); // Big Endian
        view.setUint32(6, 0, false); // repeat
        view.setUint32(10, 0, false); // metaState
        return buffer;
      };
      
      this.streamReceiver.sendControlMessage(createMsg(ACTION_DOWN));
      this.streamReceiver.sendControlMessage(createMsg(ACTION_UP));
    },
  },
};
</script>

<style scoped>
.stream-inline {
  width: 100%;
  height: 100%;
  min-height: 200px;
  position: relative;
  background: #000;
  border-radius: 12px;
  overflow: hidden;
}

.video-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.video-canvas {
  max-width: 100%;
  max-height: 100%;
  border-radius: 8px;
  touch-action: none;
}

.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(0, 0, 0, 0.8);
  border-radius: 12px;
}

.loading-spinner {
  width: 28px;
  height: 28px;
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-top-color: #00d4aa;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.loading-overlay span {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
}
</style>
