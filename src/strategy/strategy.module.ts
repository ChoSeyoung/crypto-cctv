import { Module } from '@nestjs/common';
import { StrategyService } from './strategy.service';
import { TelegramModule } from '../telegram/telegram.module';
import { ConfigModule } from '@nestjs/config';
import { StrategyController } from './strategy.controller';

@Module({
  imports: [ConfigModule, TelegramModule],
  controllers: [StrategyController],
  providers: [StrategyService],
})
export class StrategyModule {}
