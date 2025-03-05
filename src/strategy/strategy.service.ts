import { Injectable, Logger } from '@nestjs/common';
import { BinanceService } from '../binance/binance.service';
import { MACD, RSI, ADX, BollingerBands, ATR } from 'technicalindicators';
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
    const candles = await this.binanceService.getOHLCV(symbol, '5m', 50);
    if (candles.length < 30) return null;

    const closePrices = candles.map((c) => c.close);
    const latestClose = closePrices[closePrices.length - 1];

    // 📌 MACD 계산
    const macd = MACD.calculate({
      values: closePrices,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });
    const latestMACD = macd.length > 0 ? macd[macd.length - 1] : null;

    // 📌 RSI 계산
    const rsi = RSI.calculate({ values: closePrices, period: 14 });
    const latestRSI = rsi.length > 0 ? rsi[rsi.length - 1] : null;

    // 📌 ADX 계산
    const adx = ADX.calculate({
      close: closePrices,
      high: candles.map((c) => c.high),
      low: candles.map((c) => c.low),
      period: 14,
    });
    const latestADX = adx.length > 0 ? adx[adx.length - 1] : null;

    // 📌 볼린저 밴드 계산
    const bb = BollingerBands.calculate({
      values: closePrices,
      period: 20,
      stdDev: 2,
    });
    const latestBB = bb.length > 0 ? bb[bb.length - 1] : null;

    // 📌 ATR (손절 계산용)
    const atr = ATR.calculate({
      close: closePrices,
      high: candles.map((c) => c.high),
      low: candles.map((c) => c.low),
      period: 14,
    });
    const latestATR = atr.length > 0 ? atr[atr.length - 1] : null;

    // 데이터 검증
    if (
      !latestMACD ||
      latestMACD.MACD === undefined ||
      latestMACD.signal === undefined ||
      !latestRSI ||
      !latestADX ||
      latestADX.adx === undefined ||
      latestADX.pdi === undefined ||
      latestADX.mdi === undefined ||
      !latestBB ||
      !latestATR
    ) {
      this.logger.warn('🚨 Insufficient data for analysis');
      return null;
    }

    // ✅ 롱(매수) 진입 조건
    const longEntry =
      latestMACD.MACD > latestMACD.signal &&
      latestRSI > 30 &&
      latestRSI < 40 &&
      latestADX.adx > 25 &&
      latestADX.pdi > latestADX.mdi &&
      latestClose <= latestBB.lower;

    // ✅ 숏(매도) 진입 조건
    const shortEntry =
      latestMACD.MACD < latestMACD.signal &&
      latestRSI > 60 &&
      latestRSI < 70 &&
      latestADX.adx > 25 &&
      latestADX.mdi > latestADX.pdi &&
      latestClose >= latestBB.upper;

    // 🚨 **손절 (Stop Loss) 계산 수정**
    const stopLoss = longEntry
      ? latestClose - latestATR * 1.5 // 롱일 때 → 현재 가격보다 낮은 손절 설정
      : shortEntry
        ? latestClose + latestATR * 1.5 // 숏일 때 → 현재 가격보다 높은 손절 설정
        : null; // 진입 조건이 없으면 stopLoss 없음

    return { longEntry, shortEntry, stopLoss };
  }

  async enterPosition(symbol: string, amount: number) {
    const analysis = await this.analyzeMarket(symbol);

    if (!analysis) {
      this.logger.warn(`Market conditions not met for entry on ${symbol}`);
      return;
    }

    const { longEntry, shortEntry, stopLoss } = analysis;

    if (longEntry) {
      // 바이낸스 롱 포지션 진입 (매수 주문)
      const message = `🚀 롱 진입 신호 감지\n- 심볼: ${symbol}\n- 손절가: ${stopLoss?.toFixed(2)}`;

      this.logger.log(message);
      await this.telegramService.sendMessage(message);

      // 📌 바이낸스 시장가 주문 실행 (롱)
      try {
        await this.binanceService.createMarketOrder(symbol, 'buy', amount);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';

        this.logger.error(`❌ 롱 포지션 진입 실패: ${message}`);
        await this.telegramService.sendMessage(
          `❌ 롱 포지션 진입 실패: ${message}`,
        );
      }
    } else if (shortEntry) {
      // 바이낸스 숏 포지션 진입 (매도 주문)
      const message = `❄ 숏 진입 신호 감지\n- 심볼: ${symbol}\n- 손절가: ${stopLoss?.toFixed(2)}`;

      this.logger.log(message);
      await this.telegramService.sendMessage(message);

      // 📌 바이낸스 시장가 주문 실행 (숏)
      try {
        await this.binanceService.createMarketOrder(symbol, 'sell', amount);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';

        this.logger.error(`❌ 숏 포지션 진입 실패: ${message}`);
        await this.telegramService.sendMessage(
          `❌ 숏 포지션 진입 실패: ${message}`,
        );
      }
    } else {
      this.logger.log(`📉 No valid trade signals for ${symbol}`);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE) // ⏳ 1분마다 실행
  async scheduledTrade() {
    const symbols = ['BTC/USDT']; // 원하는 거래 페어 추가 가능
    const amount = 0.01; // 기본 거래 수량 설정

    for (const symbol of symbols) {
      this.logger.log(`Checking trade signals for ${symbol}...`);
      await this.enterPosition(symbol, amount);
    }
  }
}
