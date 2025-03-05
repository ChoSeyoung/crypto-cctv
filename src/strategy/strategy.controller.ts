import { Controller, Get, Query } from '@nestjs/common';
import { StrategyService } from './strategy.service';

@Controller('strategy')
export class StrategyController {
  constructor(private readonly strategyService: StrategyService) {}

  @Get('analyze')
  async analyzeMarket(@Query('symbol') symbol: string) {
    return await this.strategyService.analyzeMarket(symbol);
  }
}
