import { Pipe, PipeTransform } from '@angular/core';
import { formatMoney } from './format';

/** 1234.5 → "1,234.50"; null / non-numeric → "—". */
@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(value: unknown): string {
    return formatMoney(value);
  }
}
