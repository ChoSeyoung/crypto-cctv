import { Injectable } from '@nestjs/common';

@Injectable()
export class UtilsService {
  truncateDecimals(num: number, decimalPlaces: number) {
    const factor = Math.pow(10, decimalPlaces);
    return Math.trunc(num * factor) / factor;
  }
}
