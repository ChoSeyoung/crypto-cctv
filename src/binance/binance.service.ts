import { Injectable, Logger } from '@nestjs/common';
import * as ccxt from 'ccxt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class BinanceService {
  private exchange: ccxt.binance;
  private readonly logger = new Logger(BinanceService.name);

  constructor(private configService: ConfigService) {
    this.exchange = new ccxt.binance({
      apiKey: this.configService.get<string>('BINANCE_API_KEY'),
      secret: this.configService.get<string>('BINANCE_API_SECRET'),
    });
  }

  async getOHLCV(symbol: string, timeframe: string = '1m', limit: number = 50) {
    try {
      const candles = await this.exchange.fetchOHLCV(
        symbol,
        timeframe,
        undefined,
        limit,
      );
      return candles.map(([timestamp, open, high, low, close, volume]) => ({
        timestamp: Number(timestamp),
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume),
      }));
    } catch (error) {
      this.logger.error(`Error fetching OHLCV data: ${error.message}`);
      return [];
    }
  }
}
