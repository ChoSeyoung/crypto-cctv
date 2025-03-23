import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TelegramService } from '../telegram/telegram.service';
import { UtilsService } from '../common/utils/utils.service';
import * as ccxt from 'ccxt';
import { ConfigService } from '@nestjs/config';
import { ADX, EMA, MACD, Stochastic } from 'technicalindicators';
import { Ohlcv } from './interface/ohlcv.interface';

@Injectable()
export class StrategyService {
  private readonly logger = new Logger(StrategyService.name);
  private exchange: ccxt.binance;

  constructor(
    private configService: ConfigService,
    private readonly telegramService: TelegramService,
    private readonly utilsService: UtilsService,
  ) {
    this.exchange = new ccxt.binance({
      apiKey: this.configService.get<string>('BINANCE_API_KEY'),
      secret: this.configService.get<string>('BINANCE_API_SECRET'),
      options: { defaultType: 'future' },
    });
  }

  /**
   * 🕒 1분마다 실행 (15분 봉 기준 분석)
   */
  @Cron('*/1 * * * *')
  async executeStrategy() {
    const symbols = await this.getFuturesSymbols();
    for (const symbol of symbols) {
      console.log(symbol);
      try {
        const ohlcv = await this.fetchOHLCV(symbol);

        // 마지막 캔들의 타임스탬프 확인 (1분 단위로만 처리)
        const lastCandle = ohlcv[ohlcv.length - 2]; // **완전히 마감된 캔들 사용**

        // 기술적 지표 계산
        const indicators = await this.calculateIndicators(symbol, ohlcv);

        // 롱/숏 포지션 체크
        if (indicators.longSignal) {
          this.logger.log(`🚀 롱 포지션 진입 (가격: ${lastCandle.close})`);
          // await this.placeOrder('buy');
          await this.telegramService.sendMessage(
            `📈 [${symbol} 롱 포지션 진입] ${JSON.stringify(indicators)} 주문 완료!`,
          );
        } else if (indicators.shortSignal) {
          this.logger.log(`📉 숏 포지션 진입 (가격: ${lastCandle.close})`);
          // await this.placeOrder('sell');
          await this.telegramService.sendMessage(
            `📉 [${symbol} 숏 포지션 진입] ${JSON.stringify(indicators)} 주문 완료!`,
          );
        } else {
          this.logger.log('🔍 진입 조건 미충족, 대기...');
        }
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';

        this.logger.error(`⚠️ 전략 실행 중 오류 발생: ${message}`);
      }
    }
  }

  test() {
    return true;
  }

  private async getFuturesSymbols(): Promise<string[]> {
    try {
      const result: string[] = [];

      const markets = await this.exchange.loadMarkets();
      for (const [_, data] of Object.entries(markets)) {
        if (data === undefined) continue;

        if (
          data.quote === 'USDT' &&
          data.active &&
          !data.expiry &&
          data.contract
        ) {
          result.push(data.id as string);
        }
      }

      return result;
    } catch (error) {
      console.error('Error fetching futures symbols:', error);
      throw new Error('Failed to fetch Binance futures symbols.');
    }
  }

  /**
   * 📊 15분 봉 기준 OHLCV 데이터 가져오기
   */
  private async fetchOHLCV(symbol: string): Promise<Ohlcv[]> {
    const ohlcv = await this.exchange.fetchOHLCV(symbol, '1m', undefined, 200);

    return ohlcv.map(([timestamp, open, high, low, close, volume]) => ({
      timestamp: Number(timestamp),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
    }));
  }

  /**
   * ATR (Average True Range) 계산 함수
   * @param ohlcv
   * @param period
   * @private
   */
  private calculateATR(ohlcv: Ohlcv[], period: number): number {
    const highs = ohlcv.map((candle) => candle.high);
    const lows = ohlcv.map((candle) => candle.low);
    const closes = ohlcv.map((candle) => candle.close);

    const atrValues: number[] = [];

    for (let i = 1; i < closes.length; i++) {
      const trueRange = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1]),
      );
      atrValues.push(trueRange);
    }

    return atrValues.slice(-period).reduce((a, b) => a + b, 0) / period;
  }

  /**
   * 📈 기술적 지표 계산 (스토캐스틱 RSI, MACD, EMA, 거래량)
   */
  private async calculateIndicators(symbol: string, ohlcv: Ohlcv[]) {
    const closes = ohlcv.map((candle) => candle.close);
    const highs = ohlcv.map((candle) => candle.high);
    const lows = ohlcv.map((candle) => candle.low);
    const volumes = ohlcv.map((candle) => candle.volume);

    // 📌 스토캐스틱 RSI 계산 (14-period)
    const stochValues = Stochastic.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 14,
      signalPeriod: 3,
    });

    const lastStoch = stochValues[stochValues.length - 1];

    // 📌 MACD 계산
    const macdValues = MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });

    const lastMACD = macdValues[macdValues.length - 1];
    if (!lastMACD.MACD || !lastMACD.signal) {
      throw new Error('Plz check lastMACD.MACD or lastMACD.signal');
    }

    // 📌 EMA 계산
    const ema50 = EMA.calculate({ values: closes, period: 50 });
    const ema200 = EMA.calculate({ values: closes, period: 200 });

    const lastEma50 = ema50[ema50.length - 1];
    const lastEma200 = ema200[ema200.length - 1];

    // 📌 거래량 증가 확인 (장기 평균 대비)
    const lastVolume = volumes[volumes.length - 1];
    const avgVolumeLong = volumes.slice(-50).reduce((a, b) => a + b, 0) / 50;
    const robustVolumeIncrease = lastVolume > avgVolumeLong * 1.5;

    // 📌 ATR 계산
    const atr = this.calculateATR(ohlcv, 14);

    // 📌 추세 강도 판단 (ADX)
    const adxValues = ADX.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 14,
    });
    const lastADX = adxValues[adxValues.length - 1];
    const strongTrend = lastADX.adx > 25;

    // 📌 TP/SL 동적 설정 (추세 강도에 따른 RR조정)
    const lastClose = closes[closes.length - 1];
    const riskRewardRatio = strongTrend ? 3 : 2;

    const longTP = lastClose + atr * riskRewardRatio;
    const longSL = lastClose - atr;

    const shortTP = lastClose - atr * riskRewardRatio;
    const shortSL = lastClose + atr;

    // 📌 캔들 패턴 추가 (단순 최근 캔들 확인 예시)
    const bullishCandleConfirmation =
      closes[closes.length - 1] > highs[highs.length - 2];
    const bearishCandleConfirmation =
      closes[closes.length - 1] < lows[lows.length - 2];

    // 📌 롱/숏 신호 확인
    const longSignal =
      lastStoch.k < 20 &&
      lastStoch.d < 20 &&
      lastMACD.MACD > lastMACD.signal &&
      lastEma50 > lastEma200 &&
      robustVolumeIncrease &&
      bullishCandleConfirmation &&
      strongTrend;

    const shortSignal =
      lastStoch.k > 80 &&
      lastStoch.d > 80 &&
      lastMACD.MACD < lastMACD.signal &&
      lastEma50 < lastEma200 &&
      robustVolumeIncrease &&
      bearishCandleConfirmation &&
      strongTrend;

    // 📌 RSI 특이점 알림
    if (
      (lastStoch.k === 0 && lastStoch.d === 0) ||
      (lastStoch.k === 100 && lastStoch.d === 100)
    ) {
      await this.telegramService.sendMessage(
        `[${symbol}] RSI 특이점 확인: lastStoch.k: ${lastStoch.k}, lastStoch.d: ${lastStoch.d}`,
      );
    }

    return {
      longSignal,
      shortSignal,
      longTP: this.utilsService.truncateDecimals(longTP, 5),
      longSL: this.utilsService.truncateDecimals(longSL, 5),
      shortTP: this.utilsService.truncateDecimals(shortTP, 5),
      shortSL: this.utilsService.truncateDecimals(shortSL, 5),
    };
  }

  /**
   * 📌 포지션 진입 (롱/숏 주문 실행)
   */
  private async placeOrder(side: 'buy' | 'sell', symbol: string) {
    try {
      const amount = 0.01; // 주문 수량 (예제)
      const order = await this.exchange.createMarketOrder(symbol, side, amount);

      // 주문 성공 시 로그 및 텔레그램 알림
      this.logger.log(
        `✅ ${side.toUpperCase()} 주문 완료: ${JSON.stringify(order)}`,
      );
      await this.telegramService.sendMessage(
        `🚀 [포지션 진입] ${side.toUpperCase()} 주문 완료!`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(`❌ 주문 실패: ${message}`);
    }
  }
}
