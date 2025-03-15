import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StrategyModule } from './strategy/strategy.module';
import { ScheduleModule } from '@nestjs/schedule';
import { TelegramModule } from './telegram/telegram.module';
import { UtilsModule } from './common/utils/utils.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    ScheduleModule.forRoot(),
    StrategyModule,
    TelegramModule,
    UtilsModule,
  ],
})
export class AppModule {}
