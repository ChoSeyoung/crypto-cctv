import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as process from 'node:process';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  private readonly botToken: string;
  private readonly apiUrl: string;

  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN!;
    this.apiUrl = `https://api.telegram.org/bot${this.botToken}`;
    if (!this.botToken) {
      this.logger.error('TELEGRAM_BOT_TOKEN이 설정되지 않았습니다.');
    }
  }

  /**
   * 특정 채팅 ID로 메시지 전송
   * @param message 보낼 메시지 내용
   */
  async sendMessage(message: string): Promise<void> {
    try {
      await axios.post(`${this.apiUrl}/sendMessage`, {
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(`텔레그램 메시지 전송 중 오류 발생: ${message}`);
    }
  }
}
