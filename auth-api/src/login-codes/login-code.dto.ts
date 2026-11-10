import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';
import { LOGIN_CODE, PHONE_PATTERN } from '../common/constants';

const PHONE_ISSUE = 'must be in E.164 format, e.g. +919876543210';
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class RequestLoginCodeDto {
  @ApiProperty({ example: '+919876543210' })
  @Transform(trim)
  @IsString()
  @Matches(PHONE_PATTERN, { message: PHONE_ISSUE })
  phone!: string;
}

export class VerifyLoginCodeDto extends RequestLoginCodeDto {
  @ApiProperty({ example: '482913', description: `The ${LOGIN_CODE.DIGITS}-digit code from the doctor` })
  @Transform(trim)
  @IsString()
  @Matches(new RegExp(`^\\d{${LOGIN_CODE.DIGITS}}$`), { message: `must be ${LOGIN_CODE.DIGITS} digits` })
  code!: string;
}
