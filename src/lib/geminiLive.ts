/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";

export class GeminiLiveAssistant {
  private ai: GoogleGenAI;
  private session: any; // Using any for simplicity with complex SDK types
  private audioContext: AudioContext | null = null;
  private pcmData: Int16Array[] = [];
  private isProcessingAudio = false;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async connect(callbacks: {
    onMessage?: (text: string) => void;
    onTranscript?: (text: string, type: 'input' | 'output') => void;
  }) {
    this.session = await this.ai.live.connect({
      model: "gemini-3.1-flash-live-preview",
      callbacks: {
        onopen: () => console.log('Gemini Live session opened'),
        onmessage: async (message: LiveServerMessage) => {
          // Handle transcription
          if (message.serverContent?.modelTurn?.parts) {
             const text = message.serverContent.modelTurn.parts.map(p => p.text).filter(Boolean).join(' ');
             if (text) callbacks.onMessage?.(text);
          }

          const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
          if (base64Audio) {
            this.queueAudio(base64Audio);
          }

          if (message.serverContent?.interrupted) {
            this.clearAudioBuffer();
          }
        },
        onclose: () => console.log('Gemini Live session closed'),
        onerror: (err) => console.error('Gemini Live error:', err),
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
        },
        systemInstruction: "You are an AI Art Assistant looking at an Air Drawing canvas. Help users with their drawings, give creative tips, and describe what you see happening in the air.",
      },
    });
  }

  sendFrame(base64Image: string) {
    if (!this.session) return;
    this.session.sendRealtimeInput({
      video: { data: base64Image, mimeType: 'image/jpeg' }
    });
  }

  sendAudio(base64Audio: string) {
    if (!this.session) return;
    this.session.sendRealtimeInput({
      audio: { data: base64Audio, mimeType: 'audio/pcm;rate=16000' }
    });
  }

  private queueAudio(base64Data: string) {
    const binary = atob(base64Data);
    const buffer = new Int16Array(binary.length / 2);
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
    }
    this.pcmData.push(buffer);
    this.processAudioQueue();
  }

  private async processAudioQueue() {
    if (this.isProcessingAudio || this.pcmData.length === 0) return;
    this.isProcessingAudio = true;

    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: 24000 });
    }

    while (this.pcmData.length > 0) {
      const data = this.pcmData.shift()!;
      const float32 = new Float32Array(data.length);
      for (let i = 0; i < data.length; i++) {
        float32[i] = data[i] / 32768.0;
      }

      const buffer = this.audioContext.createBuffer(1, float32.length, 24000);
      buffer.getChannelData(0).set(float32);

      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioContext.destination);
      source.start();

      await new Promise(resolve => setTimeout(resolve, (buffer.duration * 1000) - 10));
    }

    this.isProcessingAudio = false;
  }

  private clearAudioBuffer() {
    this.pcmData = [];
    this.isProcessingAudio = false;
  }

  disconnect() {
    this.session?.close();
  }
}
