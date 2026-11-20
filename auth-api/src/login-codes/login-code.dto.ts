import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';
import { LOGIN_CODE, PHONE_ISSUE, PHONE_PATTERN, toMobile } from '../common/constants';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class RequestLoginCodeDto {
  @ApiProperty({ example: '9876543210', description: 'The 10-digit mobile number. +91 in front is accepted too.' })
  @Transform(toMobile)
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
