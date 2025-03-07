import { Injectable, Logger } from '@nestjs/common';
import { BinanceService } from '../binance/binance.service';
import { RSI, ATR } from 'technicalindicators';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TelegramService } from '../telegram/telegram.service';

@Injectable()
export class StrategyService {
  private readonly logger = new Logger(StrategyService.name);

  constructor(
    private readonly binanceService: BinanceService,
    private readonly telegramService: TelegramService,
  ) {}

  async analyzeMarket(symbol: string) {
    const candles = await this.binanceService.getOHLCV(symbol, '1m', 50);

    const closePrices = candles.map((c) => c.close);
    const latestClose = closePrices[closePrices.length - 1];

    const rsi = RSI.calculate({ values: closePrices, period: 14 });
    const latestRSI = rsi[rsi.length - 1];

    const atr = ATR.calculate({
      close: closePrices,
      high: candles.map((c) => c.high),
      low: candles.map((c) => c.low),
      period: 14,
    });
    const latestATR = atr[atr.length - 1];

    if (!latestRSI || !latestATR) {
      this.logger.warn('🚨 Insufficient data for RSI or ATR analysis');
      return null;
    }

    const longEntry = latestRSI < 20;
    const shortEntry = latestRSI > 80;

    const stopLoss = longEntry
      ? latestClose - latestATR * 1.5
      : shortEntry
        ? latestClose + latestATR * 1.5
        : -1;

    const takeProfit = longEntry
      ? latestClose + latestATR * 3
      : shortEntry
        ? latestClose - latestATR * 3
        : -1;

    this.logger.debug({
      latestRSI,
      longEntry,
      shortEntry,
      stopLoss,
      takeProfit,
    });

    return { longEntry, shortEntry, stopLoss, takeProfit };
  }

  async enterPosition(symbol: string, amount: number) {
    const analysis = await this.analyzeMarket(symbol);

    if (!analysis) {
      this.logger.warn(`Market conditions not met for entry on ${symbol}`);
      return;
    }

    const { longEntry, shortEntry, stopLoss, takeProfit } = analysis;

    if (longEntry) {
      const message = `🚀 롱 진입 신호 (RSI < 20)\n- 심볼: ${symbol}\n- 손절가: ${stopLoss?.toFixed(2)}\n- 목표가: ${takeProfit?.toFixed(2)}`;

      this.logger.log(message);
      await this.telegramService.sendMessage(message);

      // 📌 바이낸스 시장가 주문 실행 (롱)
      try {
        await this.binanceService.createMarketOrder(
          symbol,
          'buy',
          amount,
          takeProfit,
          stopLoss,
        );
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';

        this.logger.error(`❌ 롱 포지션 진입 실패: ${message}`);
        await this.telegramService.sendMessage(
          `❌ 롱 포지션 진입 실패: ${message}`,
        );
      }
    } else if (shortEntry) {
      const message = `❄️ 숏 진입 신호 (RSI > 80)\n- 심볼: ${symbol}\n- 손절가: ${stopLoss?.toFixed(2)}\n- 목표가: ${takeProfit?.toFixed(2)}`;

      this.logger.log(message);
      await this.telegramService.sendMessage(message);

      // 📌 바이낸스 시장가 주문 실행 (숏)
      try {
        await this.binanceService.createMarketOrder(
          symbol,
          'sell',
          amount,
          takeProfit,
          stopLoss,
        );
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';

        this.logger.error(`❌ 숏 포지션 진입 실패: ${message}`);
        await this.telegramService.sendMessage(
          `❌ 숏 포지션 진입 실패: ${message}`,
        );
      }
    } else {
      this.logger.log(`📉 No valid RSI trade signals for ${symbol}`);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE) // ⏳ 1분마다 실행
  async scheduledTrade() {
    const symbols = [
      'BTC/USDT',
      'ETH/USDT',
      'XRP/USDT',
      'SOL/USDT',
      'DOGE/USDT',
    ]; // 원하는 거래 페어 추가 가능
    const amount = 0.01; // 기본 거래 수량 설정

    for (const symbol of symbols) {
      this.logger.log(`Checking RSI trade signals for ${symbol}...`);
      await this.enterPosition(symbol, amount);
    }
  }
}
