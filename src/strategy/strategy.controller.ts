import { Controller, Get, Query } from '@nestjs/common';
import { StrategyService } from './strategy.service';

@Controller('strategy')
export class StrategyController {
  constructor(private readonly strategyService: StrategyService) {}

  @Get('test')
  async analyzeMarket() {
    return this.strategyService.test();
  }
}
