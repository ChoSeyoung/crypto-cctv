import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TelegramService } from '../telegram/telegram.service';
import { UtilsService } from '../common/utils/utils.service';
import * as ccxt from 'ccxt';
import { ConfigService } from '@nestjs/config';
import { ADX, EMA, MACD, RSI, Stochastic } from 'technicalindicators';
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
   * 🕒 1분마다 전략 실행
   */
  @Cron('*/1 * * * *')
  async executeStrategy() {
    const symbols = await this.getFuturesSymbols();

    for (const symbol of symbols) {
      // OHLCV 조회
      const ohlcv = await this.fetchOHLCV(symbol, '1m');

      // 롱 포지션 진입
      await this.checkLongPosition(symbol, ohlcv);
      // 숏 포지션 진입
      await this.checkShortPosition(symbol, ohlcv);
    }
  }

  private async checkLongPosition(symbol: string, ohlcv: Ohlcv[]) {
    const closes = ohlcv.map((c) => c.close);

    const ema20 = EMA.calculate({ period: 20, values: closes });
    const ema50 = EMA.calculate({ period: 50, values: closes });
    const rsi = RSI.calculate({ period: 14, values: closes });
    const macd = MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });

    const len = ema50.length;
    if (len < 2 || rsi.length < 1 || macd.length < 1) return;

    const ema20Prev = ema20[len - 2];
    const ema50Prev = ema50[len - 2];
    const ema20Curr = ema20[len - 1];
    const ema50Curr = ema50[len - 1];
    const rsiCurr = rsi[rsi.length - 1];
    const macdCurr = macd[macd.length - 1];

    // 롱 조건: EMA 골든크로스 + RSI 55 이상 + MACD 0 이상 & MACD 상승중
    if (
      ema20Prev < ema50Prev &&
      ema20Curr > ema50Curr &&
      rsiCurr > 55 &&
      macdCurr?.MACD !== undefined &&
      macdCurr.histogram !== undefined &&
      macdCurr.MACD > 0 &&
      macdCurr.histogram > 0
    ) {
      this.logger.log(`[🚀 LONG] ${symbol} 진입 조건 충족`);
      await this.telegramService.sendMessage(
        `[🚀 LONG] ${symbol} 진입 신호 발생!\nEMA 골든크로스 & RSI: ${rsiCurr.toFixed(2)} & MACD 상승`,
      );
      // 실제 주문 실행 코드 추가
    }
  }

  private async checkShortPosition(symbol: string, ohlcv: Ohlcv[]) {
    const closes = ohlcv.map((c) => c.close);

    const ema20 = EMA.calculate({ period: 20, values: closes });
    const ema50 = EMA.calculate({ period: 50, values: closes });
    const rsi = RSI.calculate({ period: 14, values: closes });
    const macd = MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });

    const len = ema50.length;
    if (len < 2 || rsi.length < 1 || macd.length < 1) return;

    const ema20Prev = ema20[len - 2];
    const ema50Prev = ema50[len - 2];
    const ema20Curr = ema20[len - 1];
    const ema50Curr = ema50[len - 1];
    const rsiCurr = rsi[rsi.length - 1];
    const macdCurr = macd[macd.length - 1];

    // 숏 조건: EMA 데드크로스 + RSI 45 이하 + MACD 0 이하 & MACD 하락중
    if (
      ema20Prev > ema50Prev &&
      ema20Curr < ema50Curr &&
      rsiCurr < 45 &&
      macdCurr?.MACD !== undefined &&
      macdCurr.histogram !== undefined &&
      macdCurr.MACD < 0 &&
      macdCurr.histogram < 0
    ) {
      this.logger.log(`[🔻 SHORT] ${symbol} 진입 조건 충족`);
      await this.telegramService.sendMessage(
        `[🔻 SHORT] ${symbol} 진입 신호 발생!\nEMA 데드크로스 & RSI: ${rsiCurr.toFixed(2)} & MACD 하락`,
      );
      // 실제 주문 실행 코드 추가
    }
  }

  /**
   * 선물 거래에 사용될 심볼 조회
   * @private
   */
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
   * 1분 봉 기준 OHLCV 데이터 가져오기
   */
  private async fetchOHLCV(
    symbol: string,
    timeframe: string,
  ): Promise<Ohlcv[]> {
    const ohlcv = await this.exchange.fetchOHLCV(
      symbol,
      timeframe,
      undefined,
      200,
    );

    return ohlcv.map(([timestamp, open, high, low, close, volume]) => ({
      timestamp: Number(timestamp),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
    }));
  }
}
