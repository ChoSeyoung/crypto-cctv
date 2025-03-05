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
    if (candles.length < 30) return null; // 최소 데이터 개수 체크

    const closePrices = candles.map((c) => c.close);

    // 1️⃣ **MACD 계산**
    const macd = MACD.calculate({
      values: closePrices,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });

    // 2️⃣ **RSI 계산**
    const rsi = RSI.calculate({ values: closePrices, period: 14 });

    // 3️⃣ **ADX 계산**
    const adx = ADX.calculate({
      close: closePrices,
      high: candles.map((c) => c.high),
      low: candles.map((c) => c.low),
      period: 14,
    });

    // 4️⃣ **볼린저 밴드 계산**
    const bb = BollingerBands.calculate({
      values: closePrices,
      period: 20,
      stdDev: 2,
    });

    // 5️⃣ **ATR 계산**
    const atr = ATR.calculate({
      close: closePrices,
      high: candles.map((c) => c.high),
      low: candles.map((c) => c.low),
      period: 14,
    });

    // 📌 최근 값 가져오기
    const latestMACD = macd[macd.length - 1];
    const latestRSI = rsi[rsi.length - 1];
    const latestADX = adx[adx.length - 1];
    const latestBB = bb[bb.length - 1];
    const latestATR = atr[atr.length - 1];

    // 방어 코드 추가
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
      this.logger.warn('Insufficient data for analysis');
      return null;
    }

    // ✅ **롱 진입 조건 체크**
    const longEntry =
      latestMACD.MACD > latestMACD.signal &&
      latestRSI > 30 &&
      latestRSI < 40 &&
      latestADX.adx > 25 &&
      latestADX.pdi > latestADX.mdi &&
      closePrices[closePrices.length - 1] <= latestBB.lower;

    // ❄ **숏 진입 조건 체크**
    const shortEntry =
      latestMACD.MACD < latestMACD.signal &&
      latestRSI > 60 &&
      latestRSI < 70 &&
      latestADX.adx > 25 &&
      latestADX.mdi > latestADX.pdi &&
      closePrices[closePrices.length - 1] >= latestBB.upper;

    return {
      longEntry,
      shortEntry,
      stopLoss: latestATR * 1.5,
    };
  }

  async enterPosition(symbol: string) {
    const analysis = await this.analyzeMarket(symbol);

    if (!analysis) {
      this.logger.warn(`Market conditions not met for entry on ${symbol}`);
      return;
    }

    const { longEntry, shortEntry, stopLoss } = analysis;

    if (longEntry) {
      this.logger.log(
        `🚀 Long entry signal for ${symbol}, setting stop loss at ${stopLoss}`,
      );
      await this.telegramService.sendMessage(
        `🚀 Long entry signal for ${symbol}, setting stop loss at ${stopLoss}`,
      );
      // 바이낸스 롱 포지션 진입 (매수 주문)
      // TODO: 바이낸스 거래 API 사용해서 매수 실행
    } else if (shortEntry) {
      this.logger.log(
        `❄ Short entry signal for ${symbol}, setting stop loss at ${stopLoss}`,
      );
      await this.telegramService.sendMessage(
        `❄ Short entry signal for ${symbol}, setting stop loss at ${stopLoss}`,
      );
      // 바이낸스 숏 포지션 진입 (매도 주문)
      // TODO: 바이낸스 거래 API 사용해서 매도 실행
    } else {
      this.logger.log(`No valid trade signals for ${symbol}`);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE) // ⏳ 1분마다 실행
  async scheduledTrade() {
    const symbols = ['BTC/USDT']; // 원하는 거래 페어 추가 가능
    for (const symbol of symbols) {
      this.logger.log(`Checking trade signals for ${symbol}...`);
      await this.enterPosition(symbol);
    }
  }
}
