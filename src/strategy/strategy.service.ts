import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TelegramService } from '../telegram/telegram.service';
import { UtilsService } from '../common/utils/utils.service';
import * as ccxt from 'ccxt';
import { ConfigService } from '@nestjs/config';
import { EMA, MACD, Stochastic } from 'technicalindicators';
import { Ohlcv } from './interface/ohlcv.interface';

@Injectable()
export class StrategyService {
  private readonly logger = new Logger(StrategyService.name);
  private exchange: ccxt.binance;
  private symbol = [
    'BTC/USDT',
    'ETH/USDT',
    'XRP/USDT',
    'SOL/USDT',
    'TRUMP/USDT',
  ]; // 거래할 심볼

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

        // 마지막 캔들의 타임스탬프 확인 (15분 단위로만 처리)
        const lastCandle = ohlcv[ohlcv.length - 2]; // **완전히 마감된 캔들 사용**

        // 기술적 지표 계산
        const indicators = this.calculateIndicators(ohlcv);

        // 롱/숏 포지션 체크
        if (indicators.longSignal) {
          this.logger.log(`🚀 롱 포지션 진입 (가격: ${lastCandle.close})`);
          // await this.placeOrder('buy');
          await this.telegramService.sendMessage(
            `📈 [롱 포지션 진입] ${JSON.stringify(indicators)} 주문 완료!`,
          );
        } else if (indicators.shortSignal) {
          this.logger.log(`📉 숏 포지션 진입 (가격: ${lastCandle.close})`);
          // await this.placeOrder('sell');
          await this.telegramService.sendMessage(
            `📉 [숏 포지션 진입] ${JSON.stringify(indicators)} 주문 완료!`,
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

  private async getFuturesSymbols(): Promise<string[]> {
    try {
      await this.exchange.loadMarkets(); // 마켓 데이터 로드
      const markets: Record<string, ccxt.Market> = this.exchange.markets;

      return Object.keys(markets).filter(
        (symbol) => markets[symbol]?.type === 'future',
      );
    } catch (error) {
      console.error('Error fetching futures symbols:', error);
      throw new Error('Failed to fetch Binance futures symbols.');
    }
  }

  /**
   * 📊 15분 봉 기준 OHLCV 데이터 가져오기
   */
  private async fetchOHLCV(symbol: string): Promise<Ohlcv[]> {
    const ohlcv = await this.exchange.fetchOHLCV(symbol, '15m', undefined, 200);

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
  private calculateIndicators(ohlcv: Ohlcv[]) {
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
      signalPeriod: 3, // %D
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

    // 📌 이동평균선 (EMA)
    const ema50 = EMA.calculate({ values: closes, period: 50 });
    const ema200 = EMA.calculate({ values: closes, period: 200 });

    // 📌 거래량 증가 확인
    const lastVolume = volumes[volumes.length - 1];
    const avgVolume = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
    const volumeIncrease = lastVolume > avgVolume * 1.5;

    // 📌 TP/SL 계산 (최근 가격 기준)
    const lastClose = closes[closes.length - 1];
    const atr = this.calculateATR(ohlcv, 14); // 14-period ATR 계산
    const riskRewardRatio = 2; // RR 비율 1:2 적용

    const longTP = lastClose + atr * riskRewardRatio; // 롱 포지션 TP
    const longSL = lastClose - atr; // 롱 포지션 SL

    const shortTP = lastClose - atr * riskRewardRatio; // 숏 포지션 TP
    const shortSL = lastClose + atr; // 숏 포지션 SL

    console.log(`
      lastStoch.k: ${lastStoch.k},
      lastStoch.d: ${lastStoch.d},
      lastMACD.MACD: ${lastMACD.MACD},
      lastMACD.signal: ${lastMACD.signal},
      lastEma50: ${ema50[ema50.length - 1]},
      lastEma200: ${ema200[ema200.length - 1]},
      volumeIncrease: ${volumeIncrease},
    `);

    // 📌 롱/숏 신호 확인
    const longSignal =
      lastStoch.k < 20 &&
      lastStoch.d < 20 &&
      lastMACD.MACD > lastMACD.signal &&
      ema50[ema50.length - 1] > ema200[ema200.length - 1] &&
      volumeIncrease;

    const shortSignal =
      lastStoch.k > 80 &&
      lastStoch.d > 80 &&
      lastMACD.MACD < lastMACD.signal &&
      ema50[ema50.length - 1] < ema200[ema200.length - 1] &&
      volumeIncrease;

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
