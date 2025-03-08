import { Injectable, Logger } from '@nestjs/common';
import * as ccxt from 'ccxt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class BinanceService {
  private exchange: ccxt.binance;
  private readonly logger = new Logger(BinanceService.name);
  private readonly trade = false;

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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(`Error fetching OHLCV data: ${message}`);
      throw new Error(`Fetch failed: ${message}`);
    }
  }

  async createMarketOrder(
    symbol: string,
    side: 'buy' | 'sell',
    amount: number,
    takeProfit: number,
    stopLoss: number,
  ) {
    if (this.trade) {
      try {
        const order = await this.exchange.createMarketOrder(
          symbol,
          side,
          amount,
        );

        // TP 주문 (목표가에서 지정가 청산)
        await this.exchange.createLimitOrder(
          symbol,
          side === 'buy' ? 'sell' : 'buy',
          amount,
          takeProfit,
        );

        // SL 주문 (손절가에서 스탑 리밋 청산)
        await this.exchange.createOrder(
          symbol,
          'stop',
          side === 'buy' ? 'sell' : 'buy',
          amount,
          stopLoss,
          {
            stopPrice: stopLoss,
          },
        );

        this.logger.log(
          `✅ Market order placed: ${side.toUpperCase()} ${amount} ${symbol}`,
        );
        return order;
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';

        this.logger.error(`❌ Order failed: ${message}`);
        throw new Error(`Order failed: ${message}`);
      }
    }
  }
}
