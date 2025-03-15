import { Module } from '@nestjs/common';
import { StrategyService } from './strategy.service';
import { TelegramModule } from '../telegram/telegram.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule, TelegramModule],
  controllers: [],
  providers: [StrategyService],
})
export class StrategyModule {}
