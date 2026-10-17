import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ALERT_STATUS, MAX_NOTE_LENGTH } from '../common/constants';

/**
 * PATCH /doctor/alerts/:alertId (v1.1):
 * { "status": "ACKNOWLEDGED", "note": "Called patient, pain settled after rest" }
 *
 * ACKNOWLEDGED is the only accepted status - alerts never reopen - so any
 * other value is a 400.
 */
export class AcknowledgeAlertDto {
  @ApiProperty({ enum: [ALERT_STATUS.ACKNOWLEDGED] })
  @IsIn([ALERT_STATUS.ACKNOWLEDGED])
  status!: typeof ALERT_STATUS.ACKNOWLEDGED;

  @ApiPropertyOptional({ maxLength: MAX_NOTE_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_NOTE_LENGTH)
  note?: string;
}
