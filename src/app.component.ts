import { Component, ChangeDetectionStrategy, signal, inject, effect, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GeminiService, ChatMessage, TextModel, ImageModel, ChatPart } from './services/gemini.service';
import { LoadingSpinnerComponent } from './components/loading-spinner/loading-spinner.component';
import { SafeUrlPipe } from './services/safe-url.pipe';
import { SafeHtmlPipe } from './services/safe-html.pipe';
import type { Chat } from '@google/genai';

declare var marked: any; // To access marked.js from the global scope

type Feature = 'chat' | 'image-gen' | 'image-edit' | 'video-gen' | 'search' | 'audio-transcribe' | 'audio-gen' | 'complex-query' | 'fast-response' | 'video-analyze';

type DisplayChatMessage = ChatMessage & {
  originalParts?: ChatPart[];
  isTranslating?: boolean;
};

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  imports: [CommonModule, FormsModule, LoadingSpinnerComponent, SafeUrlPipe, SafeHtmlPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  private geminiService = inject(GeminiService);
  private readonly CHAT_HISTORY_KEY = 'gemini_ai_suite_chat_history';

  activeFeature = signal<Feature>('chat');

  // --- State Signals ---
  // Generic
  error = signal<string | null>(null);
  
  // Model Selection
  textModels: { id: TextModel; name: string }[] = [
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' }
  ];

  // Chat
  chatPrompt = signal('');
  chatHistory = signal<DisplayChatMessage[]>([]);
  isChatLoading = signal(false);
  chatModel = signal<TextModel>('gemini-2.5-flash');
  private chat = signal<Chat | null>(null);
  chatFile = signal<File | null>(null);
  chatFilePreview = signal<string | null>(null);
  isChatFilePresent = computed(() => !!this.chatFilePreview());
  examplePrompts = [
    'Объясните квантовые вычисления простыми словами',
    'Какие есть идеи рецептов на ужин сегодня?',
    'Напиши короткий рассказ о роботе, который открыл для себя музыку.'
  ];
  isListening = signal(false);
  private recognition: any;

  // Image Gen
  imageGenPrompt = signal('Футуристический городской пейзаж с летающими автомобилями, неоновыми огнями, 4k');
  imageGenAspectRatio = signal('16:9');
  imageGenResult = signal<string | null>(null);
  isImageGenLoading = signal(false);
  imageModels: { id: ImageModel; name: string }[] = [
    { id: 'imagen-4.0-generate-001', name: 'Imagen 4' },
    { id: 'imagen-3.0-generate-001', name: 'Imagen 3' }
  ];
  imageGenModel = signal<ImageModel>('imagen-4.0-generate-001');

  // Image Edit / Analyze
  imageEditPrompt = signal('Добавьте к этому изображению зернистый ретро-фильтр.');
  imageEditFile = signal<File | null>(null);
  imageEditPreview = signal<string | null>(null);
  imageEditResult = signal<string | null>(null);
  isImageEditLoading = signal(false);
  imageEditMode = signal<'analyze' | 'edit'>('analyze');
  imageEditBrightness = signal(0);
  imageEditContrast = signal(0);
  imageEditSaturation = signal(0);
  
  imagePreviewFilters = computed(() => {
    const brightness = 1 + this.imageEditBrightness() / 100;
    const contrast = 1 + this.imageEditContrast() / 100;
    const saturate = 1 + this.imageEditSaturation() / 100;
    return `brightness(${brightness}) contrast(${contrast}) saturate(${saturate})`;
  });

  imageEditExamplePrompts = [
    { name: 'Удалить фон', prompt: 'Удали фон, оставив только главный объект.' },
    { name: 'Винтаж', prompt: 'Примени теплый винтажный фильтр в стиле 70-х.' },
    { name: 'Акварель', prompt: 'Преобразуй это изображение в акварельный рисунок.' },
    { name: 'Пиксель-арт', prompt: 'Преврати это в 8-битный пиксель-арт.' },
  ];

  // Video Gen
  videoGenPrompt = signal('Астронавт верхом на лошади на Марсе, кинематографично');
  videoGenAspectRatio = signal('16:9');
  videoGenFile = signal<File | null>(null);
  videoGenFilePreview = signal<string | null>(null);
  videoGenResult = signal<string | null>(null);
  isVideoGenLoading = signal(false);
  videoGenLoadingMessage = signal('');
  
  // Search
  searchPrompt = signal('Кто выиграл последнюю гонку Формулы-1?');
  searchTool = signal<'googleSearch' | 'googleMaps'>('googleSearch');
  searchResult = signal<{text: string; chunks: any[]}>({text: '', chunks: []});
  isSearchLoading = signal(false);

  // Audio Transcribe
  isRecording = signal(false);
  audioResult = signal<string | null>(null);
  isAudioLoading = signal(false);
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];

  // Audio Gen
  audioGenPrompt = signal('Чистый, дружелюбный голос, говорящий: "Добро пожаловать в будущее творчества на базе ИИ."');
  audioGenResult = signal<string | null>(null);
  isAudioGenLoading = signal(false);
  
  // Fast Response
  fastResponsePrompt = signal('Назови три забавных факта об океане?');
  fastResponseResult = signal<string | null>(null);
  isFastResponseLoading = signal(false);
  fastResponseModel = signal<TextModel>('gemini-2.5-flash-lite');
  
  // Complex Query
  complexQueryPrompt = signal('Объясни теорию относительности так, как будто мне пять лет.');
  complexQueryResult = signal<string | null>(null);
  isComplexQueryLoading = signal(false);
  complexQueryModel = signal<TextModel>('gemini-2.5-pro');

  // Video Analyze
  videoAnalyzePrompt = signal('Что является главным объектом этого видео?');
  videoAnalyzeFile = signal<File | null>(null);
  videoAnalyzePreview = signal<string | null>(null);
  videoAnalyzeResult = signal<string | null>(null);
  isVideoAnalyzeLoading = signal(false);
  
  constructor() {
    this.loadChatHistory();

    // Save chat history to localStorage on change
    effect(() => {
        const historyToSave = this.chatHistory().map(message => ({
          role: message.role,
          // Only save text parts to avoid exceeding localStorage quota with base64 data
          parts: message.parts.filter(part => 'text' in part)
        }));

        try {
          localStorage.setItem(this.CHAT_HISTORY_KEY, JSON.stringify(historyToSave));
        } catch (e) {
            console.error('Failed to save chat history to localStorage:', e);
            if (e instanceof DOMException && (e.name === 'QuotaExceededError' || (e.message && e.message.includes('exceeded the quota')))) {
              this.error.set('Не удалось сохранить историю чата: превышен лимит хранилища. Чтобы избежать этого, очистите историю.');
            }
        }
    });
    
    // Reset chat session when model changes
    effect(() => {
        this.chatModel(); // Establish dependency
        this.chat.set(null);
    });

    this.setupSpeechRecognition();

    effect(() => {
        const file = this.imageEditFile();
        if (file) {
            this.imageEditResult.set(null);
            this.revertImageEdits(false);
        }
        this.updatePreview(file, this.imageEditPreview);
    });
    effect(() => {
        const file = this.videoGenFile();
        this.updatePreview(file, this.videoGenFilePreview);
    });
    effect(() => {
        const file = this.videoAnalyzeFile();
        this.updatePreview(file, this.videoAnalyzePreview);
    });
     effect(() => {
        const file = this.chatFile();
        this.updatePreview(file, this.chatFilePreview);
    });
  }

  private loadChatHistory() {
    try {
      const savedHistory = localStorage.getItem(this.CHAT_HISTORY_KEY);
      if (savedHistory) {
        this.chatHistory.set(JSON.parse(savedHistory));
      }
    } catch (e) {
      console.error('Could not load chat history from local storage', e);
      localStorage.removeItem(this.CHAT_HISTORY_KEY);
    }
  }

  private setupSpeechRecognition() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = false;
      this.recognition.lang = 'ru-RU';
      this.recognition.interimResults = false;
      this.recognition.maxAlternatives = 1;

      this.recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        this.chatPrompt.update(p => p ? `${p} ${transcript}`: transcript);
      };

      this.recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        this.isListening.set(false);
        if (event.error === 'not-allowed') {
            this.error.set('Доступ к микрофону запрещен. Пожалуйста, разрешите доступ к микрофону в настройках вашего браузера.');
        }
      };
      
      this.recognition.onend = () => {
        this.isListening.set(false);
      };
    }
  }

  private updatePreview(file: File | null, previewSignal: ReturnType<typeof signal<string | null>>) {
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => previewSignal.set(e.target?.result as string);
        reader.readAsDataURL(file);
    } else {
        previewSignal.set(null);
    }
  }

  handleFileChange(event: Event, targetSignal: ReturnType<typeof signal<File | null>>) {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) {
      targetSignal.set(input.files[0]);
    }
  }
  
  private async handleError(error: unknown) {
    console.error(error);
    this.error.set(error instanceof Error ? error.message : 'Произошла неизвестная ошибка.');
  }

  // --- Feature Methods ---
  async sendChatMessage() {
    const currentPrompt = this.chatPrompt().trim();
    const currentFile = this.chatFile();
    if ((!currentPrompt && !currentFile) || this.isChatLoading()) return;

    this.isChatLoading.set(true);
    this.error.set(null);
    
    const userParts: ChatPart[] = [];
    if (currentPrompt) {
        userParts.push({ text: currentPrompt });
    }
    if (currentFile) {
        try {
            const { base64, mimeType } = await this.geminiService.fileToBase64(currentFile);
            userParts.push({ inlineData: { data: base64, mimeType }});
        } catch(e) {
            await this.handleError(e);
            this.isChatLoading.set(false);
            return;
        }
    }

    this.chatHistory.update(h => [...h, { role: 'user', parts: userParts }]);
    this.chatPrompt.set('');
    this.chatFile.set(null);
    this.chatHistory.update(h => [...h, { role: 'model', parts: [{ text: '' }] }]);

    try {
      if (!this.chat()) {
        const historyWithoutDisplayProps = this.chatHistory().map(({ role, parts }) => ({ role, parts }));
        const chatSession = await this.geminiService.startChat(historyWithoutDisplayProps.slice(0, -2), this.chatModel());
        this.chat.set(chatSession);
      }

      const chat = this.chat();
      if (!chat) throw new Error('Chat session not initialized.');

      const stream = await chat.sendMessageStream({ message: userParts });
      for await (const chunk of stream) {
        const chunkText = chunk.text;
        this.chatHistory.update(h => {
          const lastMessage = h[h.length - 1];
          if (lastMessage && lastMessage.parts.length > 0) {
            const lastPart = lastMessage.parts[lastMessage.parts.length - 1];
             if ('text' in lastPart) {
                lastPart.text += chunkText;
            }
          }
          return [...h];
        });
      }
    } catch (e) {
      this.chatHistory.update(h => h.slice(0, -1));
      await this.handleError(e);
    } finally {
      this.isChatLoading.set(false);
    }
  }

  messageHasText(message: DisplayChatMessage): boolean {
    if (!message?.parts) {
      return false;
    }
    return message.parts.some(p => 'text' in p && p.text && p.text.trim().length > 0);
  }

  async translateMessage(messageIndex: number) {
    const history = this.chatHistory();
    const message = history[messageIndex];

    if (!message || message.isTranslating) return;

    // --- Case 1: Revert translation ---
    if (message.originalParts) {
        this.chatHistory.update(currentHistory => 
            currentHistory.map((msg, index) => {
                if (index === messageIndex) {
                    const { originalParts, ...rest } = msg;
                    return { ...rest, parts: originalParts! };
                }
                return msg;
            })
        );
        return;
    }

    // --- Case 2: Perform new translation ---
    this.chatHistory.update(currentHistory =>
        currentHistory.map((msg, index) =>
            index === messageIndex ? { ...msg, isTranslating: true } : msg
        )
    );

    try {
        const textToTranslate = message.parts
            .filter((p): p is { text: string } => 'text' in p && !!p.text)
            .map(p => p.text)
            .join(' ');
        
        const containsCyrillic = /[а-яА-Я]/.test(textToTranslate);
        const targetLanguage = containsCyrillic ? 'English' : 'Russian';
        const originalParts = JSON.parse(JSON.stringify(message.parts));

        const translatedPartsPromises = message.parts.map(part => {
            if ('text' in part && part.text.trim()) {
                return this.geminiService.translateText(part.text, targetLanguage)
                    .then(translatedText => ({ text: translatedText }));
            }
            return Promise.resolve(part); // Return non-text parts as is
        });

        const newParts = await Promise.all(translatedPartsPromises);

        this.chatHistory.update(currentHistory =>
            currentHistory.map((msg, index) =>
                index === messageIndex
                ? {
                    ...msg,
                    parts: newParts,
                    originalParts: originalParts,
                    isTranslating: false,
                    }
                : msg
            )
        );

    } catch (e) {
        await this.handleError(e);
        this.chatHistory.update(currentHistory =>
            currentHistory.map((msg, index) =>
                index === messageIndex ? { ...msg, isTranslating: false } : msg
            )
        );
    }
  }

  clearChatHistory() {
    this.chatHistory.set([]);
    this.chat.set(null);
    localStorage.removeItem(this.CHAT_HISTORY_KEY);
  }

  sendExamplePrompt(prompt: string) {
    this.chatPrompt.set(prompt);
    this.sendChatMessage();
  }

  parseMarkdown(text: string): string {
    if (typeof marked !== 'undefined') {
      return marked.parse(text, { breaks: true, gfm: true });
    }
    return text; // Fallback to plain text if marked isn't loaded
  }

  toggleVoiceInput() {
    if (!this.recognition) {
        this.error.set('Распознавание речи не поддерживается в этом браузере.');
        return;
    }
    if (this.isListening()) {
        this.recognition.stop();
    } else {
        this.recognition.start();
        this.isListening.set(true);
    }
  }

  handleChatFileChange(event: Event) {
    this.handleFileChange(event, this.chatFile);
  }

  clearChatFile() {
    this.chatFile.set(null);
  }

  async generateImage() {
    if (!this.imageGenPrompt() || this.isImageGenLoading()) return;
    this.isImageGenLoading.set(true);
    this.imageGenResult.set(null);
    this.error.set(null);
    try {
      const response = await this.geminiService.generateImage(this.imageGenPrompt(), this.imageGenAspectRatio(), this.imageGenModel());
      const base64Image = response.generatedImages[0].image.imageBytes;
      this.imageGenResult.set(`data:image/jpeg;base64,${base64Image}`);
    } catch (e) {
      await this.handleError(e);
    } finally {
      this.isImageGenLoading.set(false);
    }
  }

  exportGeneratedImage() {
    const resultUrl = this.imageGenResult();
    if (!resultUrl) return;
    const link = document.createElement('a');
    link.href = resultUrl;
    link.download = `ai-generated-image-${Date.now()}.jpeg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  applyImageEditPrompt(prompt: string) {
    this.imageEditPrompt.set(prompt);
  }

  private _constructEditPrompt(): string {
    let finalPrompt = this.imageEditPrompt();
    const advancedEdits: string[] = [];

    const describeLevel = (value: number, term: string): string | null => {
        if (value > 75) return `drastically increase the ${term}`;
        if (value > 35) return `significantly increase the ${term}`;
        if (value > 5) return `slightly increase the ${term}`;
        if (value < -75) return `drastically decrease the ${term}`;
        if (value < -35) return `significantly decrease the ${term}`;
        if (value < -5) return `slightly decrease the ${term}`;
        return null;
    };
    
    const brightnessDesc = describeLevel(this.imageEditBrightness(), 'brightness');
    if (brightnessDesc) advancedEdits.push(brightnessDesc);

    const contrastDesc = describeLevel(this.imageEditContrast(), 'contrast');
    if (contrastDesc) advancedEdits.push(contrastDesc);

    const saturationDesc = describeLevel(this.imageEditSaturation(), 'saturation');
    if (saturationDesc) advancedEdits.push(saturationDesc);

    if (advancedEdits.length > 0) {
        let editClause = advancedEdits.join(', ');
        editClause = editClause.charAt(0).toUpperCase() + editClause.slice(1);

        if (finalPrompt.trim()) {
            const lastChar = finalPrompt.trim().slice(-1);
            if (['.', '!', '?'].includes(lastChar)) {
                 finalPrompt += ` ${editClause}.`;
            } else {
                 finalPrompt += `. ${editClause}.`;
            }
        } else {
            finalPrompt = `${editClause}.`;
        }
    }
    return finalPrompt;
  }

  async analyzeOrEditImage() {
    const file = this.imageEditFile();
    if (!this.imageEditPrompt() && this.imageEditMode() === 'analyze') {
        this.error.set("Пожалуйста, введите запрос для анализа.");
        return;
    }
    if (!file || this.isImageEditLoading()) return;

    let finalPrompt = this.imageEditPrompt();
    if (this.imageEditMode() === 'edit') {
        finalPrompt = this._constructEditPrompt();
        if (!finalPrompt.trim()) {
            this.error.set("Пожалуйста, введите запрос или измените ползунки, чтобы отредактировать изображение.");
            return;
        }
    }
    
    this.isImageEditLoading.set(true);
    this.imageEditResult.set(null);
    this.error.set(null);
    
    try {
      const { base64, mimeType } = await this.geminiService.fileToBase64(file);
      if (this.imageEditMode() === 'analyze') {
        const response = await this.geminiService.analyzeImage(this.imageEditPrompt(), base64, mimeType);
        this.imageEditResult.set(response.text);
      } else { // 'edit' mode
        const editedImageBase64 = await this.geminiService.editImage(finalPrompt, base64, mimeType);
        this.imageEditResult.set(`data:image/jpeg;base64,${editedImageBase64}`);
      }
    } catch (e) {
      await this.handleError(e);
    } finally {
      this.isImageEditLoading.set(false);
    }
  }

  revertImageEdits(clearResult: boolean = true) {
    if (clearResult) {
        this.imageEditResult.set(this.imageEditPreview());
    }
    this.imageEditBrightness.set(0);
    this.imageEditContrast.set(0);
    this.imageEditSaturation.set(0);
  }
  
  async generateVideo() {
    if (!this.videoGenPrompt() || this.isVideoGenLoading()) return;
    this.isVideoGenLoading.set(true);
    this.videoGenResult.set(null);
    this.error.set(null);
    this.videoGenLoadingMessage.set('Начинается генерация видео... это может занять несколько минут.');
    
    try {
        let imageArg;
        const file = this.videoGenFile();
        if (file) {
            this.videoGenLoadingMessage.set('Обработка загруженного изображения для генерации видео...');
            imageArg = await this.geminiService.fileToBase64(file);
        }
        
        this.videoGenLoadingMessage.set('Генерация видео с помощью Veo. Пожалуйста, подождите, это может занять несколько минут.');
        const resultUrl = await this.geminiService.generateVideo(this.videoGenPrompt(), this.videoGenAspectRatio(), imageArg);
        this.videoGenResult.set(resultUrl);

    } catch(e) {
        await this.handleError(e);
    } finally {
        this.isVideoGenLoading.set(false);
        this.videoGenLoadingMessage.set('');
    }
  }

  exportGeneratedVideo() {
    const resultUrl = this.videoGenResult();
    if (!resultUrl) return;
    const link = document.createElement('a');
    link.href = resultUrl;
    link.download = `ai-generated-video-${Date.now()}.mp4`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  async executeSearch() {
    if (!this.searchPrompt() || this.isSearchLoading()) return;
    this.isSearchLoading.set(true);
    this.searchResult.set({ text: '', chunks: [] });
    this.error.set(null);
    try {
        const response = await this.geminiService.groundedSearch(this.searchPrompt(), this.searchTool());
        const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        this.searchResult.set({ text: response.text, chunks });
    } catch (e) {
        await this.handleError(e);
    } finally {
        this.isSearchLoading.set(false);
    }
  }

  async toggleRecording() {
    if (this.isRecording()) {
      this.mediaRecorder?.stop();
      this.isRecording.set(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.isRecording.set(true);
        this.audioResult.set(null);
        this.error.set(null);
        this.audioChunks = [];
        this.mediaRecorder = new MediaRecorder(stream);
        this.mediaRecorder.ondataavailable = event => this.audioChunks.push(event.data);
        this.mediaRecorder.onstop = async () => {
          this.isAudioLoading.set(true);
          const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
          const { base64, mimeType } = await this.geminiService.fileToBase64(new File([audioBlob], "recording.webm"));
          try {
              const response = await this.geminiService.transcribeAudio(base64, mimeType);
              this.audioResult.set(response.text);
          } catch(e) {
              await this.handleError(e);
          } finally {
              this.isAudioLoading.set(false);
          }
        };
        this.mediaRecorder.start();
      } catch (e) {
        await this.handleError(e);
      }
    }
  }

  async generateAudio() {
    if (!this.audioGenPrompt() || this.isAudioGenLoading()) return;
    this.isAudioGenLoading.set(true);
    this.audioGenResult.set(null);
    this.error.set(null);
    try {
        const resultUrl = await this.geminiService.generateAudio(this.audioGenPrompt());
        this.audioGenResult.set(resultUrl);
    } catch (e) {
        await this.handleError(e);
    } finally {
        this.isAudioGenLoading.set(false);
    }
  }
  
  async getFastResponse() {
    if (!this.fastResponsePrompt() || this.isFastResponseLoading()) return;
    this.isFastResponseLoading.set(true);
    this.fastResponseResult.set(null);
    this.error.set(null);
    try {
        const response = await this.geminiService.generateText(this.fastResponsePrompt(), this.fastResponseModel());
        this.fastResponseResult.set(response.text);
    } catch (e) {
        await this.handleError(e);
    } finally {
        this.isFastResponseLoading.set(false);
    }
  }

  async getComplexResponse() {
    if (!this.complexQueryPrompt() || this.isComplexQueryLoading()) return;
    this.isComplexQueryLoading.set(true);
    this.complexQueryResult.set(null);
    this.error.set(null);
    try {
        const response = await this.geminiService.generateText(this.complexQueryPrompt(), this.complexQueryModel());
        this.complexQueryResult.set(response.text);
    } catch (e) {
        await this.handleError(e);
    } finally {
        this.isComplexQueryLoading.set(false);
    }
  }
  
  async analyzeVideo() {
    const file = this.videoAnalyzeFile();
    if (!this.videoAnalyzePrompt() || !file || this.isVideoAnalyzeLoading()) return;
    this.isVideoAnalyzeLoading.set(true);
    this.videoAnalyzeResult.set(null);
    this.error.set(null);
    try {
      const { base64, mimeType } = await this.geminiService.fileToBase64(file);
      const response = await this.geminiService.analyzeVideo(this.videoAnalyzePrompt(), base64, mimeType);
      this.videoAnalyzeResult.set(response.text);
    } catch (e) {
      await this.handleError(e);
    } finally {
      this.isVideoAnalyzeLoading.set(false);
    }
  }
}
