import { Module } from '@nestjs/common';
import { BinanceService } from './binance.service';
import { BinanceController } from './binance.controller';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  controllers: [BinanceController],
  providers: [BinanceService],
  exports: [BinanceService],
})
export class BinanceModule {}
