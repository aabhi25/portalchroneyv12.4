// AudioWorklet processor for capturing PCM16 audio at 24kHz for OpenAI Realtime API
// Handles resampling from microphone sample rate (typically 48kHz) to 24kHz
// with proper fractional position tracking to avoid sample drift

class PCM16AudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.TARGET_SAMPLE_RATE = 24000; // OpenAI Realtime API expects 24kHz
    
    // Use the actual audio processing graph sample rate (not from options)
    // sampleRate is a global property in AudioWorkletGlobalScope
    this.sourceSampleRate = sampleRate;
    
    // Calculate resampling ratio
    this.resampleRatio = this.sourceSampleRate / this.TARGET_SAMPLE_RATE; // source / target
    
    this.bufferSize = 2048; // Process in chunks
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
    
    // For maintaining fractional position across process() calls
    this.lastSample = 0;
    this.fractionalPosition = 0;
    
    console.log(`[PCM16AudioProcessor] Source: ${this.sourceSampleRate}Hz, Target: ${this.TARGET_SAMPLE_RATE}Hz, Ratio: ${this.resampleRatio}`);
    
    // Post actual sample rate back to main thread for diagnostics
    this.port.postMessage({
      type: 'sampleRate',
      sourceSampleRate: this.sourceSampleRate,
      targetSampleRate: this.TARGET_SAMPLE_RATE
    });
  }

  /**
   * Resample audio using linear interpolation with fractional position tracking
   * This ensures accurate sample counts over time without drift
   */
  resample(inputSamples) {
    const output = [];
    
    // Continue from where we left off in the previous call
    let position = this.fractionalPosition;
    
    while (true) {
      const index = Math.floor(position);
      const fraction = position - index;
      
      // Check if we've consumed all input samples
      if (index >= inputSamples.length) {
        break;
      }
      
      // Linear interpolation
      let sample;
      if (index + 1 < inputSamples.length) {
        sample = inputSamples[index] * (1 - fraction) + inputSamples[index + 1] * fraction;
      } else {
        // Use last sample from previous buffer for interpolation
        sample = inputSamples[index] * (1 - fraction) + this.lastSample * fraction;
      }
      
      output.push(sample);
      
      // Advance by the resample ratio (source samples per output sample)
      position += this.resampleRatio;
    }
    
    // Store the last sample for next interpolation
    if (inputSamples.length > 0) {
      this.lastSample = inputSamples[inputSamples.length - 1];
    }
    
    // Store fractional position for next call (subtract consumed samples)
    this.fractionalPosition = position - inputSamples.length;
    
    return new Float32Array(output);
  }

  /**
   * Convert Float32 audio samples to Int16 PCM format
   */
  float32ToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      // Clamp to [-1, 1] range and convert to 16-bit integer
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    
    // Check if we have input audio
    if (!input || !input[0]) {
      return true;
    }

    const inputChannel = input[0]; // Mono audio (channel 0)

    // Resample to target rate with fractional position tracking
    const resampled = this.resample(inputChannel);

    // Accumulate resampled samples into buffer
    for (let i = 0; i < resampled.length; i++) {
      this.buffer[this.bufferIndex++] = resampled[i];

      // When buffer is full, convert and send to main thread
      if (this.bufferIndex >= this.bufferSize) {
        // Convert Float32 to Int16 PCM
        const pcm16Data = this.float32ToInt16(this.buffer);
        
        // Send binary data to main thread
        this.port.postMessage({
          type: 'audio',
          data: pcm16Data.buffer
        }, [pcm16Data.buffer]); // Transfer ownership for performance

        // Reset buffer
        this.bufferIndex = 0;
        this.buffer = new Float32Array(this.bufferSize);
      }
    }

    return true; // Keep processor alive
  }
}

registerProcessor('pcm16-audio-processor', PCM16AudioProcessor);
