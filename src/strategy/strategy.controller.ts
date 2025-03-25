import { Controller, Get } from '@nestjs/common';
import { StrategyService } from './strategy.service';

@Controller('strategy')
export class StrategyController {
  constructor(private readonly strategyService: StrategyService) {}

  @Get('test')
  analyzeMarket() {
    return true;
  }
}
