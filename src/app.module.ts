import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BinanceModule } from './binance/binance.module';
import { StrategyModule } from './strategy/strategy.module';
import { ScheduleModule } from '@nestjs/schedule';
import { TelegramModule } from './telegram/telegram.module';
import { UtilsModule } from './common/utils/utils.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    ScheduleModule.forRoot(),
    BinanceModule,
    StrategyModule,
    TelegramModule,
    UtilsModule,
  ],
})
export class AppModule {}
