import { Injectable } from '@angular/core';
import { GoogleGenAI } from "@google/genai";

// Define types for multimodal chat messages
type TextPart = { text: string };
type InlineDataPart = { inlineData: { data: string; mimeType: string; } };
export type ChatPart = TextPart | InlineDataPart;

export type ChatMessage = {
  role: string;
  parts: ChatPart[];
};

export type TextModel = 'gemini-2.5-pro' | 'gemini-2.5-flash' | 'gemini-2.5-flash-lite';
export type ImageModel = 'imagen-4.0-generate-001' | 'imagen-3.0-generate-001';

@Injectable({
  providedIn: 'root'
})
export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    // IMPORTANT: This assumes process.env.API_KEY is available in the execution environment.
    // Do not hardcode API keys in a real application.
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      throw new Error("API_KEY environment variable not set.");
    }
    this.ai = new GoogleGenAI({ apiKey });
  }

  // --- Text Generation ---
  async generateText(prompt: string, model: TextModel) {
    return this.ai.models.generateContent({
      model,
      contents: prompt,
      config: model === 'gemini-2.5-pro' 
        ? { thinkingConfig: { thinkingBudget: 32768 } }
        : undefined,
    });
  }

  async translateText(text: string, targetLanguage: 'Russian' | 'English'): Promise<string> {
    const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Translate the following text to ${targetLanguage}. Provide only the translation, without any introductory phrases or explanations. Text to translate: "${text}"`,
        config: {
            temperature: 0.1,
        }
    });
    return response.text.trim();
  }

  async startChat(history: ChatMessage[], model: TextModel) {
    return this.ai.chats.create({
        model,
        history: history
    });
  }

  // --- Search Grounding ---
  async groundedSearch(prompt: string, tool: 'googleSearch' | 'googleMaps') {
    const tools = tool === 'googleSearch' ? [{ googleSearch: {} }] : [{ googleMaps: {} }];
    return this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          tools,
        },
    });
  }

  // --- Vision ---
  async analyzeImage(prompt: string, imageBase64: string, mimeType: string) {
    const imagePart = { inlineData: { data: imageBase64, mimeType } };
    const textPart = { text: prompt };
    return this.ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [textPart, imagePart] },
    });
  }

  async editImage(prompt: string, imageBase64: string, mimeType: string): Promise<string> {
    const imagePart = { inlineData: { data: imageBase64, mimeType } };
    const textPart = { text: prompt };
    const response = await this.ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [textPart, imagePart] },
      config: {
        responseMimeType: 'image/jpeg'
      }
    });

    const part = response.candidates?.[0]?.content?.parts?.[0];
    if (part && 'inlineData' in part && part.inlineData) {
      return part.inlineData.data;
    }
    
    if (response.text) {
        throw new Error(`Image editing returned text instead of an image: "${response.text}"`);
    }

    throw new Error('Image editing failed to return an image.');
  }

  async analyzeVideo(prompt: string, videoBase64: string, mimeType: string) {
    const videoPart = { inlineData: { data: videoBase64, mimeType } };
    const textPart = { text: prompt };
    return this.ai.models.generateContent({
      model: 'gemini-2.5-pro',
      contents: { parts: [textPart, videoPart] },
    });
  }

  // --- Image Generation ---
  async generateImage(prompt: string, aspectRatio: string, model: ImageModel) {
    return this.ai.models.generateImages({
      model,
      prompt,
      config: {
        numberOfImages: 1,
        outputMimeType: 'image/jpeg',
        aspectRatio,
      },
    });
  }

  // --- Audio ---
  async transcribeAudio(audioBase64: string, mimeType: string) {
    const audioPart = { inlineData: { data: audioBase64, mimeType } };
    const textPart = { text: "Transcribe the following audio." };
    return this.ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [textPart, audioPart] },
    });
  }

  async generateAudio(prompt: string): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: prompt,
      config: {
        responseMimeType: 'audio/mpeg',
      },
    });

    const part = response.candidates?.[0]?.content?.parts?.[0];
    if (part && 'inlineData' in part && part.inlineData) {
      const audioBase64 = part.inlineData.data;
      const audioBlob = await (await fetch(`data:audio/mpeg;base64,${audioBase64}`)).blob();
      return URL.createObjectURL(audioBlob);
    }
    
    if (response.text) {
        throw new Error(`Audio generation returned text instead of audio: "${response.text}"`);
    }

    throw new Error('Audio generation failed to return audio data.');
  }

  // --- Video Generation ---
  async generateVideo(prompt: string, aspectRatio: string, image?: { base64: string; mimeType: string }) {
    let operation;
    const config = { numberOfVideos: 1, aspectRatio };
    
    if (image) {
      operation = await this.ai.models.generateVideos({
        model: 'veo-2.0-generate-001',
        prompt,
        image: { imageBytes: image.base64, mimeType: image.mimeType },
        config,
      });
    } else {
      operation = await this.ai.models.generateVideos({
        model: 'veo-2.0-generate-001',
        prompt,
        config,
      });
    }
  
    while (!operation.done) {
      await new Promise(resolve => setTimeout(resolve, 10000));
      operation = await this.ai.operations.getVideosOperation({ operation });
    }
  
    const uri = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!uri) {
      throw new Error("Video generation failed or returned no URI.");
    }

    const response = await fetch(`${uri}&key=${process.env.API_KEY}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch video: ${response.statusText}`);
    }
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  }
  
  // --- Helpers ---
  async fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve({ base64, mimeType: file.type });
      };
      reader.onerror = error => reject(error);
    });
  }
}