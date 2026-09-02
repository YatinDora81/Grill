/* global AudioWorkletProcessor, registerProcessor */
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.count = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    this.chunks.push(new Float32Array(ch));
    this.count += ch.length;
    if (this.count >= 1600) {
      const out = new Float32Array(this.count);
      let o = 0;
      for (const c of this.chunks) {
        out.set(c, o);
        o += c.length;
      }
      this.port.postMessage(out, [out.buffer]);
      this.chunks = [];
      this.count = 0;
    }
    return true;
  }
}

registerProcessor("pcm16-capture", PcmCapture);
