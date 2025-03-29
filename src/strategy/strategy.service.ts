import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TelegramService } from '../telegram/telegram.service';
import * as ccxt from 'ccxt';
import { ConfigService } from '@nestjs/config';
import { EMA, MACD, RSI, ATR } from 'technicalindicators';
import { Ohlcv } from './interface/ohlcv.interface';
import { Position } from 'ccxt';

@Injectable()
export class StrategyService {
  private readonly logger = new Logger(StrategyService.name);
  private exchange: ccxt.binance;

  constructor(
    private configService: ConfigService,
    private readonly telegramService: TelegramService,
  ) {
    this.exchange = new ccxt.binance({
      apiKey: this.configService.get<string>('BINANCE_API_KEY'),
      secret: this.configService.get<string>('BINANCE_API_SECRET'),
      // 테스트넷 활성화 필요시 주석 해제
      // apiKey: this.configService.get<string>('TESTNET_API_KEY'),
      // secret: this.configService.get<string>('TESTNET_API_SECRET'),
      options: {
        defaultType: 'future',
      },
    });
    // 테스트넷 활성화 필요시 주석 해제
    // this.exchange.setSandboxMode(true);
  }

  /**
   * 🕒 1분마다 전략 실행
   */
  @Cron('*/1 * * * *')
  async executeStrategy() {
    await this.exchange.loadTimeDifference(); // 🔥 추천 (시간 동기화)

    const symbols = await this.getFuturesSymbols();

    for (const symbol of symbols) {
      await this.cancelOpenOrders(symbol); // 미체결 주문 관리

      const ohlcv = await this.fetchOHLCV(symbol, '1m');
      const atr = this.calculateATR(ohlcv);

      await this.checkNewPositions(symbol, ohlcv, atr);
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
      for (const market of Object.entries(markets)) {
        const data = market[1];
        if (data === undefined) continue;

        if (
          data.quote === 'USDT' &&
          data.active &&
          !data.expiry &&
          data.contract
        ) {
          result.push(data.symbol);
        }
      }

      return result;
    } catch (error) {
      this.logger.error('Error fetching futures symbols:', error);
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

  private async getOrderAmount(symbol: string, price: number): Promise<number> {
    const amountInUSDT = 10; // 10 USDT 고정
    const markets = await this.exchange.loadMarkets();
    const market = markets[symbol];
    if (!market) throw new Error('마켓 조회 불가');
    const amountPrecision = market.precision.amount;

    return Number((amountInUSDT / price).toFixed(amountPrecision));
  }

  private async getPosition(symbol: string) {
    const positions = await this.exchange.fetchPositionsRisk([symbol]);
    const position = positions.find((p: Position) => Number(p.contracts) !== 0);

    if (!position) {
      return null;
    }

    return {
      entryPrice: Number(position.entryPrice),
      amount: Number(position.contracts),
      side: Number(position.contracts) > 0 ? 'long' : 'short',
      unrealizedPnl: Number(position.unrealizedPnl),
    };
  }

  private calculateATR(ohlcv: Ohlcv[], period = 14): number {
    const atrValues = ATR.calculate({
      high: ohlcv.map((c) => c.high),
      low: ohlcv.map((c) => c.low),
      close: ohlcv.map((c) => c.close),
      period,
    });

    return atrValues[atrValues.length - 1];
  }

  private async checkNewPositions(symbol: string, ohlcv: Ohlcv[], atr: number) {
    const closes = ohlcv.map((c) => c.close);
    const ema20 = EMA.calculate({ period: 20, values: closes });
    const ema50 = EMA.calculate({ period: 50, values: closes });
    const rsi = RSI.calculate({ period: 14, values: closes });
    const macd = MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false, // 추가됨
      SimpleMASignal: false, // 추가됨
    });

    const len = ema50.length;
    if (len < 2 || rsi.length < 1 || macd.length < 1) return;

    const [ema20Prev, ema50Prev, ema20Curr, ema50Curr] = [
      ema20[len - 2],
      ema50[len - 2],
      ema20[len - 1],
      ema50[len - 1],
    ];
    const rsiCurr = rsi[rsi.length - 1];
    const macdCurr = macd[macd.length - 1];

    if (
      macdCurr?.MACD !== undefined &&
      macdCurr?.histogram !== undefined &&
      macdCurr.MACD > 0 &&
      macdCurr.histogram > 0
    ) {
      // 롱 진입 조건
      if (
        ema20Prev < ema50Prev &&
        ema20Curr > ema50Curr &&
        rsiCurr > 55 &&
        macdCurr.MACD > 0 &&
        macdCurr.histogram > 0
      ) {
        const entryPrice = closes[closes.length - 1];
        const stopLoss = entryPrice - atr;
        const takeProfit = entryPrice + atr * 2;

        await this.telegramService.sendMessage(
          `LONG ${symbol} / entry: ${entryPrice}, TP: ${takeProfit}, SL: ${stopLoss}`,
        );

        // 주문 실행
        await this.openPosition(
          symbol,
          'buy',
          entryPrice,
          stopLoss,
          takeProfit,
          'LONG',
        );
      }

      // 숏 진입 조건
      else if (
        ema20Prev > ema50Prev &&
        ema20Curr < ema50Curr &&
        rsiCurr < 45 &&
        macdCurr.MACD < 0 &&
        macdCurr.histogram < 0
      ) {
        const entryPrice = closes[closes.length - 1];
        const stopLoss = entryPrice + atr;
        const takeProfit = entryPrice - atr * 2;

        await this.telegramService.sendMessage(
          `SHORT ${symbol} / entry: ${entryPrice}, TP: ${takeProfit}, SL: ${stopLoss}`,
        );

        // 주문 실행
        await this.openPosition(
          symbol,
          'sell',
          entryPrice,
          stopLoss,
          takeProfit,
          'SHORT',
        );
      }
    }
  }

  private async cancelOpenOrders(symbol: string) {
    const orders = await this.exchange.fetchOpenOrders(symbol);
    for (const order of orders) {
      await this.exchange.cancelOrder(order.id, symbol);
      this.logger.log(`[🔄 주문취소] ${symbol} 주문ID: ${order.id}`);
    }
  }

  private async openPosition(
    symbol: string,
    side: 'buy' | 'sell',
    entryPrice: number,
    stopLossPrice: number,
    takeProfitPrice: number,
    positionSide: 'LONG' | 'SHORT', // ✅ 추가
  ) {
    const amount = await this.getOrderAmount(symbol, entryPrice);

    // 1️⃣ 시장가 주문 (포지션 진입)
    try {
      await this.exchange.createMarketOrder(symbol, side, amount, {
        positionSide,
      } as any);
    } catch (error) {
      this.logger.error('포지션 진입 오류:', error);
      throw new Error('포지션 진입 오류');
    }

    // 2️⃣ 손절 (Stop-Limit)
    try {
      await this.exchange.createOrder(
        symbol,
        'STOP',
        side === 'buy' ? 'sell' : 'buy',
        amount,
        stopLossPrice, // Limit 가격
        {
          stopPrice: stopLossPrice, // trigger 가격과 limit 가격 동일 설정 가능
          closePosition: true,
          reduceOnly: true,
        },
      );
    } catch (error) {
      this.logger.error('SL 설정 오류:', error);
    }

    // 3️⃣ 익절 (Take Profit)
    try {
      await this.exchange.createOrder(
        symbol,
        'TAKE_PROFIT',
        side === 'buy' ? 'sell' : 'buy',
        amount,
        takeProfitPrice, // Limit 가격
        {
          stopPrice: takeProfitPrice, // trigger 가격과 limit 가격 동일 설정 가능
          closePosition: true,
          reduceOnly: true,
        },
      );
    } catch (error) {
      this.logger.error('TP 설정 오류:', error);
    }

    await this.telegramService.sendMessage(
      `[📌 ${side.toUpperCase()} 포지션 진입] ${symbol}\n진입가: ${entryPrice}\n손절가(Limit): ${stopLossPrice.toFixed(2)}\n익절가(Limit): ${takeProfitPrice.toFixed(2)}`,
    );
  }
}
