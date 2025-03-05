import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BinanceModule } from './binance/binance.module';
import { StrategyModule } from './strategy/strategy.module';
import { ScheduleModule } from '@nestjs/schedule';
import { TelegramModule } from './telegram/telegram.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath:
        process.env.NODE_ENV === 'production'
          ? '.env.production'
          : '.env.local',
    }),
    ScheduleModule.forRoot(),
    BinanceModule,
    StrategyModule,
    TelegramModule,
  ],
})
export class AppModule {}
