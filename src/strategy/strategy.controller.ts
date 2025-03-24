import { Controller, Get } from '@nestjs/common';

@Controller('strategy')
export class StrategyController {
  @Get('test')
  analyzeMarket() {
    return true;
  }
}
