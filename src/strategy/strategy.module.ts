import { Module } from '@nestjs/common';
import { StrategyService } from './strategy.service';
import { StrategyController } from './strategy.controller';
import { BinanceModule } from '../binance/binance.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [BinanceModule, TelegramModule],
  controllers: [StrategyController],
  providers: [StrategyService],
})
export class StrategyModule {}
