import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TelegramService {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 텔레그램 메시지 전송
   * @param message 보낼 메시지 내용
   */
  async sendMessage(message: string): Promise<void> {
    const botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    const chatId = this.configService.get<string>('TELEGRAM_CHAT_ID');
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

    try {
      await firstValueFrom(
        this.httpService.post(url, {
          chat_id: chatId,
          text: message,
        }),
      );
    } catch (error) {
      console.error('텔레그램 메시지 전송 실패:', error);
    }
  }
}
